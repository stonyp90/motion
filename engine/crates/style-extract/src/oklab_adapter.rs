//! Pure-Rust style extractor: Oklab k-means palette + velocity-profile
//! easing classification + shot-rhythm stats.

use crate::{
    EasingLabel, EasingPreset, OklabSwatch, ShotRhythm, StyleCard, StyleExtractor, TransitionKind,
};
use anyhow::Result;
use kmeans_colors::{Kmeans, Sort, get_kmeans};
use motion_forge_decompose::{SceneManifest, SpriteManifest};
use palette::{IntoColor, Oklab, Srgb};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Copy)]
pub struct OklabStyleExtractor {
    pub palette_k: usize,
    pub max_pixels_per_atlas: usize,
    pub kmeans_iters: usize,
    pub kmeans_seed: u64,
    pub min_swatch_weight: f32,
}

impl Default for OklabStyleExtractor {
    fn default() -> Self {
        Self {
            palette_k: 6,
            max_pixels_per_atlas: 4096,
            kmeans_iters: 20,
            kmeans_seed: 1_234_567,
            min_swatch_weight: 0.02,
        }
    }
}

impl StyleExtractor for OklabStyleExtractor {
    fn extract(&mut self, scene: &SceneManifest, sprites: &SpriteManifest) -> Result<StyleCard> {
        let palette = extract_palette(self, sprites)?;
        let easing_presets = classify_easings(sprites);
        let shot_rhythm = compute_rhythm(scene);
        let transitions = derive_transitions(scene);
        let dominant_classes = dominant_classes(sprites);

        Ok(StyleCard {
            palette,
            easing_presets,
            shot_rhythm,
            transitions,
            dominant_classes,
        })
    }
}

fn extract_palette(
    cfg: &OklabStyleExtractor,
    sprites: &SpriteManifest,
) -> Result<Vec<OklabSwatch>> {
    let mut samples: Vec<Oklab> = Vec::new();
    for sprite in &sprites.sprites {
        let path: PathBuf = sprites.work_dir.join(&sprite.atlas_path);
        let img = match image::open(&path) {
            Ok(i) => i.to_rgba8(),
            Err(e) => {
                tracing::warn!(path = %path.display(), error = %e, "skipping unreadable atlas");
                continue;
            }
        };
        let mut idx = 0usize;
        for chunk in img.pixels() {
            if chunk.0[3] < 128 {
                idx += 1;
                continue;
            }
            // Stride to cap samples per atlas — k-means cost is linear in N.
            let stride = ((img.pixels().count().max(1)) / cfg.max_pixels_per_atlas).max(1);
            if idx % stride == 0 {
                let srgb = Srgb::new(
                    chunk.0[0] as f32 / 255.0,
                    chunk.0[1] as f32 / 255.0,
                    chunk.0[2] as f32 / 255.0,
                );
                let oklab: Oklab = srgb.into_linear().into_color();
                samples.push(oklab);
            }
            idx += 1;
        }
    }

    if samples.is_empty() {
        return Ok(Vec::new());
    }

    let runs = run_kmeans_oklab(&samples, cfg.palette_k, cfg.kmeans_iters, cfg.kmeans_seed);
    let total: f32 = runs.iter().map(|s| s.weight).sum::<f32>().max(1.0);
    let mut swatches: Vec<OklabSwatch> = runs
        .into_iter()
        .filter(|s| s.weight / total >= cfg.min_swatch_weight)
        .map(|s| {
            let srgb: Srgb<f32> = Srgb::from_linear(Oklab::new(s.l, s.a, s.b).into_color());
            let hex = [
                (srgb.red.clamp(0.0, 1.0) * 255.0) as u8,
                (srgb.green.clamp(0.0, 1.0) * 255.0) as u8,
                (srgb.blue.clamp(0.0, 1.0) * 255.0) as u8,
            ];
            OklabSwatch {
                l: s.l,
                a: s.a,
                b: s.b,
                weight: s.weight / total,
                hex,
            }
        })
        .collect();
    swatches.sort_by(|a, b| {
        b.weight
            .partial_cmp(&a.weight)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(swatches)
}

struct SwatchAcc {
    l: f32,
    a: f32,
    b: f32,
    weight: f32,
}

fn run_kmeans_oklab(samples: &[Oklab], k: usize, iters: usize, seed: u64) -> Vec<SwatchAcc> {
    // Flatten Oklab to f32 triplets that kmeans_colors can cluster as Lab.
    use palette::Lab;
    let lab_samples: Vec<Lab> = samples
        .iter()
        .map(|o| Lab::new(o.l * 100.0, o.a * 100.0, o.b * 100.0))
        .collect();

    let result = (0..3)
        .map(|run| get_kmeans::<Lab>(k, iters, 5.0, false, &lab_samples, seed + run as u64))
        .min_by(|a, b| {
            a.score
                .partial_cmp(&b.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .unwrap_or_else(|| Kmeans {
            score: f32::INFINITY,
            centroids: Vec::new(),
            indices: Vec::new(),
        });

    let sorted = Lab::sort_indexed_colors(&result.centroids, &result.indices);
    sorted
        .into_iter()
        .map(|c| SwatchAcc {
            l: c.centroid.l / 100.0,
            a: c.centroid.a / 100.0,
            b: c.centroid.b / 100.0,
            weight: c.percentage,
        })
        .collect()
}

fn classify_easings(sprites: &SpriteManifest) -> Vec<EasingPreset> {
    let mut counts: HashMap<EasingLabel, u32> = HashMap::new();
    for sprite in &sprites.sprites {
        if sprite.track.len() < 4 {
            continue;
        }
        let positions: Vec<(f32, f32)> = sprite.track.iter().map(|k| (k.tx, k.ty)).collect();
        let velocities: Vec<f32> = positions
            .windows(2)
            .map(|w| {
                let dx = w[1].0 - w[0].0;
                let dy = w[1].1 - w[0].1;
                (dx * dx + dy * dy).sqrt()
            })
            .collect();
        let total_motion: f32 = velocities.iter().sum();
        if total_motion < 1e-3 {
            continue;
        }
        let label = classify_velocity_profile(&velocities);
        *counts.entry(label).or_insert(0) += 1;
    }

    let total: u32 = counts.values().sum::<u32>().max(1);
    let mut presets: Vec<EasingPreset> = counts
        .into_iter()
        .map(|(label, n)| EasingPreset {
            label,
            cubic_bezier: label.canonical_bezier(),
            weight: n as f32 / total as f32,
        })
        .collect();
    presets.sort_by(|a, b| {
        b.weight
            .partial_cmp(&a.weight)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    if presets.is_empty() {
        presets.push(EasingPreset {
            label: EasingLabel::Standard,
            cubic_bezier: EasingLabel::Standard.canonical_bezier(),
            weight: 1.0,
        });
    }
    presets
}

fn classify_velocity_profile(v: &[f32]) -> EasingLabel {
    let n = v.len();
    if n < 3 {
        return EasingLabel::Linear;
    }
    let third = n / 3;
    let start: f32 = v[..third].iter().sum::<f32>() / third.max(1) as f32;
    let mid: f32 = v[third..n - third].iter().sum::<f32>() / (n - 2 * third).max(1) as f32;
    let end: f32 = v[n - third..].iter().sum::<f32>() / third.max(1) as f32;

    // Heuristic: compare segment means.
    let r_se = if start > 1e-3 { end / start } else { 0.0 };
    let r_ms = if start > 1e-3 { mid / start } else { 0.0 };
    let bounciness =
        v.windows(2).map(|w| (w[1] - w[0]).abs()).sum::<f32>() / (v.iter().sum::<f32>().max(1e-3));

    if bounciness > 1.5 {
        EasingLabel::Bounce
    } else if r_se < 0.5 {
        EasingLabel::Decelerate
    } else if r_se > 2.0 {
        EasingLabel::Accelerate
    } else if r_ms > 1.5 && r_se < 1.2 {
        EasingLabel::Standard
    } else if (r_se - 1.0).abs() < 0.15 && (r_ms - 1.0).abs() < 0.15 {
        EasingLabel::Linear
    } else {
        EasingLabel::Sharp
    }
}

fn compute_rhythm(scene: &SceneManifest) -> ShotRhythm {
    let n = scene.boundaries.len();
    if n == 0 {
        return ShotRhythm {
            shot_count: 0,
            mean_seconds: 0.0,
            stddev_seconds: 0.0,
        };
    }
    let durations: Vec<f32> = scene
        .boundaries
        .iter()
        .map(|b| b.end_seconds - b.start_seconds)
        .collect();
    let mean = durations.iter().sum::<f32>() / n as f32;
    let var = durations.iter().map(|d| (d - mean).powi(2)).sum::<f32>() / n as f32;
    ShotRhythm {
        shot_count: n as u32,
        mean_seconds: mean,
        stddev_seconds: var.sqrt(),
    }
}

fn derive_transitions(scene: &SceneManifest) -> Vec<TransitionKind> {
    // Default to Cut for every boundary; a future detector can distinguish
    // CrossFade / Wipe / MorphCut by analyzing the frames around each cut.
    (0..scene.boundaries.len().saturating_sub(1))
        .map(|_| TransitionKind::Cut)
        .collect()
}

fn dominant_classes(sprites: &SpriteManifest) -> Vec<String> {
    let mut counts: HashMap<String, u32> = HashMap::new();
    for s in &sprites.sprites {
        *counts.entry(s.class_name.clone()).or_insert(0) += 1;
    }
    let mut v: Vec<(String, u32)> = counts.into_iter().collect();
    v.sort_by_key(|b| std::cmp::Reverse(b.1));
    v.into_iter().take(5).map(|(k, _)| k).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_linear_profile() {
        let v = vec![1.0_f32; 30];
        assert_eq!(classify_velocity_profile(&v), EasingLabel::Linear);
    }

    #[test]
    fn classify_decelerate_profile() {
        let v: Vec<f32> = (0..30).map(|i| (30 - i) as f32).collect();
        assert_eq!(classify_velocity_profile(&v), EasingLabel::Decelerate);
    }

    #[test]
    fn classify_accelerate_profile() {
        let v: Vec<f32> = (0..30).map(|i| i as f32).collect();
        assert_eq!(classify_velocity_profile(&v), EasingLabel::Accelerate);
    }
}
