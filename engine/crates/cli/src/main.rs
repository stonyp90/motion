use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(
    name = "motion-forge",
    version,
    about = "Segment a motion-design video and re-animate from a prompt (local-first, theme-aware, fast iteration)"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Phase 1 — round-trip decode + encode of an MP4 (fidelity gate).
    Transcode { input: PathBuf, output: PathBuf },

    /// Phase 2 — per-frame instance segmentation + tracking.
    Segment {
        input: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },

    /// Phase 3 — scene-split + sprite decomposition.
    Decompose {
        input: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },

    /// Phase 4 — extract a style card from a reference video.
    StyleCard {
        input: PathBuf,
        #[arg(long)]
        out: PathBuf,
    },

    /// Phase 5/6 — prompt + reference video → .lottie file (and optional MP4).
    /// Persists every intermediate in `--work-dir` so `iterate` can replay.
    Generate {
        #[arg(long)]
        reference: PathBuf,
        #[arg(long)]
        prompt: String,
        /// Theme slug (corporate, playful, ...) or path to a theme JSON file.
        #[arg(long)]
        theme: Option<String>,
        /// Output composition width in pixels. Default: theme or 1920.
        #[arg(long)]
        width: Option<u32>,
        /// Output composition height in pixels. Default: theme or 1080.
        #[arg(long)]
        height: Option<u32>,
        /// Frame rate. Default: theme or 30.
        #[arg(long)]
        fps: Option<f32>,
        /// Target duration in seconds. Default: theme default or 6.
        #[arg(long)]
        duration: Option<f32>,
        /// Where to persist intermediates (segmentation, scenes, sprites, style.json).
        #[arg(long)]
        work_dir: Option<PathBuf>,
        /// Output .lottie / .json path.
        #[arg(long)]
        out: PathBuf,
        /// If set, also render a final MP4 to this path.
        #[arg(long)]
        out_video: Option<PathBuf>,
    },

    /// Phase 5 (only) — fast iteration against a cached `--work-dir`. Skips
    /// segmentation, scenes, sprites, style extraction. Re-runs the LLM only.
    Iterate {
        /// Directory left behind by a prior `generate`.
        #[arg(long)]
        work_dir: PathBuf,
        #[arg(long)]
        prompt: String,
        #[arg(long)]
        theme: Option<String>,
        #[arg(long)]
        width: Option<u32>,
        #[arg(long)]
        height: Option<u32>,
        #[arg(long)]
        fps: Option<f32>,
        #[arg(long)]
        duration: Option<f32>,
        #[arg(long)]
        out: PathBuf,
        #[arg(long)]
        out_video: Option<PathBuf>,
    },

    /// Phase 6 — render a .lottie file to MP4.
    Render { input: PathBuf, output: PathBuf },

    /// Convenience: full pipeline that also writes MP4 (alias of `generate --out-video`).
    Pipeline {
        #[arg(long)]
        reference: PathBuf,
        #[arg(long)]
        prompt: String,
        #[arg(long)]
        theme: Option<String>,
        #[arg(long)]
        width: Option<u32>,
        #[arg(long)]
        height: Option<u32>,
        #[arg(long)]
        fps: Option<f32>,
        #[arg(long)]
        duration: Option<f32>,
        #[arg(long)]
        work_dir: Option<PathBuf>,
        #[arg(long)]
        out: PathBuf,
        /// Optional Lottie sidecar output.
        #[arg(long)]
        out_lottie: Option<PathBuf>,
    },

    /// Transcribe an audio file to text via the Whisper sidecar (local).
    /// Prints the text to stdout so it can be piped into --prompt.
    Transcribe {
        input: PathBuf,
        #[arg(long, default_value = "tiny")]
        model: String,
        #[arg(long)]
        language: Option<String>,
    },

    /// Build a polished panelized Lottie from a directory of illustrations
    /// (PNG/JPEG). Ken-burns + crossfade between panels, optional headline
    /// card, themed background — no LLM needed; the output IS the source art
    /// in motion.
    Panelize {
        /// Directory containing the panel images. Sorted naturally (e.g.
        /// "Chr-P-2" before "Chr-P-10").
        #[arg(long)]
        dir: PathBuf,
        /// Theme slug (corporate, playful, ...) or path to a theme JSON.
        /// Drives background, accent, frame rate, composition size.
        #[arg(long)]
        theme: Option<String>,
        /// Headline shown over a card at the open + close. Skip for none.
        #[arg(long)]
        headline: Option<String>,
        /// Seconds each panel stays fully visible. Defaults to theme rhythm.
        #[arg(long)]
        panel_seconds: Option<f32>,
        /// Cross-fade overlap between consecutive panels (seconds).
        #[arg(long, default_value_t = 0.4)]
        crossfade_seconds: f32,
        /// Ken-burns intensity. 0 disables. 0.06 = subtle. 0.15 = strong.
        #[arg(long, default_value_t = 0.06)]
        ken_burns: f32,
        /// Output composition width / height / fps. Default: theme or 1920x1080@30.
        #[arg(long)]
        width: Option<u32>,
        #[arg(long)]
        height: Option<u32>,
        #[arg(long)]
        fps: Option<f32>,
        /// Output .lottie / .json path.
        #[arg(long)]
        out: PathBuf,
        /// If set, also render a final MP4 to this path.
        #[arg(long)]
        out_video: Option<PathBuf>,
    },

    /// List bundled themes.
    Themes,

    /// Start an HTTP server with an OpenAPI spec at /openapi.json.
    Serve {
        #[arg(long, default_value = "127.0.0.1:7755")]
        bind: String,
    },

    /// Figma ingest commands (import a frame as a character or scene).
    Figma {
        #[command(subcommand)]
        sub: FigmaSub,
    },
}

#[derive(Subcommand)]
enum FigmaSub {
    /// Import a Figma frame as a character sprite or scene background.
    Import {
        /// Figma share URL — accepts /file/, /design/, or /proto/ shapes.
        #[arg(long)]
        url: String,
        /// Optional node id override; falls back to the URL's `node-id` param.
        #[arg(long)]
        node_id: Option<String>,
        /// `character` (sprite) or `scene` (background).
        #[arg(long, default_value = "character")]
        kind: String,
        /// Figma personal-access token. Reads `FIGMA_TOKEN` env if omitted.
        #[arg(long, env = "FIGMA_TOKEN")]
        token: String,
        /// Where to write the converted Lottie layer JSON.
        #[arg(long)]
        out: PathBuf,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::parse();
    match cli.command {
        Command::Transcode { input, output } => cmd_transcode(input, output),
        Command::Segment { input, out } => cmd_segment(input, out),
        Command::Decompose { input, out } => cmd_decompose(input, out),
        Command::StyleCard { input, out } => cmd_style_card(input, out),
        Command::Generate {
            reference,
            prompt,
            theme,
            width,
            height,
            fps,
            duration,
            work_dir,
            out,
            out_video,
        } => {
            cmd_generate(GenerateArgs {
                reference,
                prompt,
                theme,
                width,
                height,
                fps,
                duration,
                work_dir,
                out,
                out_video,
            })
            .await
        }
        Command::Iterate {
            work_dir,
            prompt,
            theme,
            width,
            height,
            fps,
            duration,
            out,
            out_video,
        } => {
            cmd_iterate(IterateArgs {
                work_dir,
                prompt,
                theme,
                width,
                height,
                fps,
                duration,
                out,
                out_video,
            })
            .await
        }
        Command::Render { input, output } => cmd_render(input, output),
        Command::Pipeline {
            reference,
            prompt,
            theme,
            width,
            height,
            fps,
            duration,
            work_dir,
            out,
            out_lottie,
        } => {
            // Pipeline = generate with required out_video. If out_lottie not
            // given, drop it next to out.
            let lottie_path = out_lottie.unwrap_or_else(|| {
                out.with_extension(format!(
                    "{}.lottie.json",
                    out.file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("pipeline")
                ))
            });
            cmd_generate(GenerateArgs {
                reference,
                prompt,
                theme,
                width,
                height,
                fps,
                duration,
                work_dir,
                out: lottie_path,
                out_video: Some(out),
            })
            .await
        }
        Command::Transcribe {
            input,
            model,
            language,
        } => cmd_transcribe(input, model, language),
        Command::Panelize {
            dir,
            theme,
            headline,
            panel_seconds,
            crossfade_seconds,
            ken_burns,
            width,
            height,
            fps,
            out,
            out_video,
        } => cmd_panelize(PanelizeArgs {
            dir,
            theme,
            headline,
            panel_seconds,
            crossfade_seconds,
            ken_burns,
            width,
            height,
            fps,
            out,
            out_video,
        }),
        Command::Themes => cmd_themes(),
        Command::Serve { bind } => motion_forge_http::serve(&bind).await,
        Command::Figma { sub } => match sub {
            FigmaSub::Import {
                url,
                node_id,
                kind,
                token,
                out,
            } => cmd_figma_import(url, node_id, kind, token, out).await,
        },
    }
}

// ---- subcommand bodies ----

fn cmd_transcode(input: PathBuf, output: PathBuf) -> Result<()> {
    use motion_forge_video_io::{
        Codec, Decoder, EncoderConfig, sidecar_adapter::SidecarDecoder,
        sidecar_adapter::SidecarEncoder,
    };
    let mut dec = SidecarDecoder::open(&input)?;
    tracing::info!(
        width = dec.width(),
        height = dec.height(),
        fps = dec.frame_rate(),
        "decoded input"
    );
    let config = EncoderConfig {
        width: dec.width(),
        height: dec.height(),
        frame_rate: dec.frame_rate(),
        bitrate_kbps: 4000,
        codec: Codec::H264,
    };
    let mut enc = SidecarEncoder::create(&output, config)?;
    let mut frames = 0u64;
    while let Some(frame) = dec.next_frame()? {
        enc.push_frame(&frame)?;
        frames += 1;
    }
    enc.finish()?;
    tracing::info!(frames, "transcode complete");
    Ok(())
}

fn cmd_segment(input: PathBuf, out: PathBuf) -> Result<()> {
    use motion_forge_segment::Segmenter;
    use motion_forge_segment::python_sidecar_adapter::PythonSidecarSegmenter;
    let mut seg = PythonSidecarSegmenter::default_in_workspace();
    let manifest = seg.segment_video(&input, &out)?;
    tracing::info!(
        backend = %manifest.backend,
        model = %manifest.model,
        frames = manifest.frames.len(),
        total_masks = manifest.total_masks(),
        "segmentation complete"
    );
    Ok(())
}

fn cmd_decompose(input: PathBuf, out: PathBuf) -> Result<()> {
    use motion_forge_decompose::{
        SceneSplitter, SpriteDecomposer,
        python_sidecar_adapter::{BboxCropSpriteDecomposer, PySceneDetectSplitter},
    };
    use motion_forge_segment::Segmenter;
    use motion_forge_segment::python_sidecar_adapter::PythonSidecarSegmenter;

    std::fs::create_dir_all(&out)?;
    let seg_dir = out.join("segmentation");
    let scenes_dir = out.join("scenes");
    let sprites_dir = out.join("sprites");

    let mut segmenter = PythonSidecarSegmenter::default_in_workspace();
    let seg_manifest = segmenter.segment_video(&input, &seg_dir)?;
    tracing::info!(masks = seg_manifest.total_masks(), "segmentation phase ok");

    let mut splitter = PySceneDetectSplitter::default();
    let scene_manifest = splitter.split(&input, &scenes_dir)?;
    tracing::info!(shots = scene_manifest.boundaries.len(), "scene split ok");

    let mut decomposer = BboxCropSpriteDecomposer;
    let sprite_manifest =
        decomposer.decompose(&input, &seg_dir.join("manifest.json"), &sprites_dir)?;
    tracing::info!(
        sprites = sprite_manifest.sprite_count,
        "sprite decomposition ok"
    );
    Ok(())
}

fn cmd_style_card(input: PathBuf, out: PathBuf) -> Result<()> {
    use motion_forge_decompose::{
        SceneSplitter, SpriteDecomposer,
        python_sidecar_adapter::{BboxCropSpriteDecomposer, PySceneDetectSplitter},
    };
    use motion_forge_segment::Segmenter;
    use motion_forge_segment::python_sidecar_adapter::PythonSidecarSegmenter;
    use motion_forge_style_extract::{StyleExtractor, oklab_adapter::OklabStyleExtractor};

    let work = derive_work_dir(&out, "style");
    std::fs::create_dir_all(&work)?;
    let seg_dir = work.join("segmentation");
    let scenes_dir = work.join("scenes");
    let sprites_dir = work.join("sprites");

    let mut seg = PythonSidecarSegmenter::default_in_workspace();
    seg.segment_video(&input, &seg_dir)?;
    let mut splitter = PySceneDetectSplitter::default();
    let scene_manifest = splitter.split(&input, &scenes_dir)?;
    let mut decomposer = BboxCropSpriteDecomposer;
    let sprite_manifest =
        decomposer.decompose(&input, &seg_dir.join("manifest.json"), &sprites_dir)?;
    let mut extractor = OklabStyleExtractor::default();
    let card = extractor.extract(&scene_manifest, &sprite_manifest)?;
    motion_forge_style_extract::write_card(&card, &out)?;
    tracing::info!(
        swatches = card.palette.len(),
        easing_presets = card.easing_presets.len(),
        shots = card.shot_rhythm.shot_count,
        "style card written"
    );
    Ok(())
}

struct GenerateArgs {
    reference: PathBuf,
    prompt: String,
    theme: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    fps: Option<f32>,
    duration: Option<f32>,
    work_dir: Option<PathBuf>,
    out: PathBuf,
    out_video: Option<PathBuf>,
}

async fn cmd_generate(args: GenerateArgs) -> Result<()> {
    use motion_forge_pipeline::{Composition, GenerateConfig, Pipeline};
    use motion_forge_style_extract::Theme;

    let theme = args
        .theme
        .as_deref()
        .map(Theme::resolve)
        .transpose()
        .context("loading theme")?;

    let comp = Composition {
        width: args.width.unwrap_or(0),
        height: args.height.unwrap_or(0),
        frame_rate: args.fps.unwrap_or(0.0),
    };
    let duration = args.duration.unwrap_or(0.0);
    let work_dir = args
        .work_dir
        .unwrap_or_else(|| derive_work_dir(&args.out, "gen"));

    let config = GenerateConfig {
        reference_video: args.reference,
        prompt: args.prompt,
        theme,
        composition: comp,
        duration_seconds: duration,
        work_dir,
        output_lottie: args.out,
        output_video: args.out_video,
    };
    let result = Pipeline::new().run_full(config).await?;
    tracing::info!(
        backend = %result.backend_name,
        shots = result.timeline.shots.len(),
        duration = result.timeline.duration_seconds,
        out_lottie = %result.output_lottie.display(),
        out_video = result.output_video.as_ref().map(|p| p.display().to_string()).unwrap_or_else(|| "(none)".into()),
        work_dir = %result.work_dir.display(),
        "generate complete"
    );
    Ok(())
}

struct IterateArgs {
    work_dir: PathBuf,
    prompt: String,
    theme: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    fps: Option<f32>,
    duration: Option<f32>,
    out: PathBuf,
    out_video: Option<PathBuf>,
}

async fn cmd_iterate(args: IterateArgs) -> Result<()> {
    use motion_forge_pipeline::{Composition, IterateConfig, Pipeline};
    use motion_forge_style_extract::Theme;

    let theme = args
        .theme
        .as_deref()
        .map(Theme::resolve)
        .transpose()
        .context("loading theme")?;
    let composition_override =
        if args.width.is_some() || args.height.is_some() || args.fps.is_some() {
            Some(Composition {
                width: args.width.unwrap_or(1920),
                height: args.height.unwrap_or(1080),
                frame_rate: args.fps.unwrap_or(30.0),
            })
        } else {
            None
        };

    let config = IterateConfig {
        work_dir: args.work_dir,
        prompt: args.prompt,
        theme,
        composition_override,
        duration_seconds: args.duration,
        output_lottie: args.out,
        output_video: args.out_video,
    };
    let started = std::time::Instant::now();
    let result = Pipeline::new().run_iterate(config).await?;
    tracing::info!(
        backend = %result.backend_name,
        elapsed_ms = started.elapsed().as_millis() as u64,
        shots = result.timeline.shots.len(),
        duration = result.timeline.duration_seconds,
        out_lottie = %result.output_lottie.display(),
        "iterate complete"
    );
    Ok(())
}

fn cmd_render(input: PathBuf, output: PathBuf) -> Result<()> {
    use motion_forge_render::{
        RenderConfig, Renderer, python_sidecar_adapter::PythonLottieRenderer,
    };
    let mut r = PythonLottieRenderer::default_in_workspace();
    let raw = std::fs::read_to_string(&input)?;
    let v: serde_json::Value = serde_json::from_str(&raw)?;
    let config = RenderConfig {
        width: v["w"].as_u64().unwrap_or(1920) as u32,
        height: v["h"].as_u64().unwrap_or(1080) as u32,
        frame_rate: v["fr"].as_f64().unwrap_or(30.0),
        bitrate_kbps: 4000,
        codec: motion_forge_video_io::Codec::H264,
    };
    r.render(&input, &output, &config)?;
    tracing::info!(out = %output.display(), "render complete");
    Ok(())
}

fn cmd_transcribe(input: PathBuf, model: String, language: Option<String>) -> Result<()> {
    use std::process::Command;
    let workspace = workspace_root()?;
    let script = workspace.join("scripts/transcribe.py");
    let python = workspace.join(".venv/bin/python");
    let mut cmd = Command::new(python);
    cmd.arg(script)
        .arg("--input")
        .arg(&input)
        .arg("--model")
        .arg(&model);
    if let Some(lang) = language {
        cmd.arg("--language").arg(lang);
    }
    cmd.stderr(std::process::Stdio::inherit());
    let output = cmd.output().with_context(|| "spawning whisper sidecar")?;
    if !output.status.success() {
        anyhow::bail!(
            "whisper sidecar failed with status {:?}",
            output.status.code()
        );
    }
    // Pass the transcribed text straight through on stdout so it can be piped.
    std::io::Write::write_all(&mut std::io::stdout(), &output.stdout)?;
    Ok(())
}

struct PanelizeArgs {
    dir: PathBuf,
    theme: Option<String>,
    headline: Option<String>,
    panel_seconds: Option<f32>,
    crossfade_seconds: f32,
    ken_burns: f32,
    width: Option<u32>,
    height: Option<u32>,
    fps: Option<f32>,
    out: PathBuf,
    out_video: Option<PathBuf>,
}

fn cmd_panelize(args: PanelizeArgs) -> Result<()> {
    use motion_forge_lottie_gen::panelize::{
        PanelizeConfig, build_panelize_lottie, list_panel_images,
    };
    use motion_forge_lottie_gen::write_lottie_value;
    use motion_forge_render::{
        RenderConfig, Renderer, python_sidecar_adapter::PythonLottieRenderer,
    };
    use motion_forge_style_extract::Theme;
    use motion_forge_video_io::Codec;

    let images = list_panel_images(&args.dir)?;
    if images.is_empty() {
        anyhow::bail!("no PNG/JPEG/WebP files found in {}", args.dir.display());
    }
    tracing::info!(
        dir = %args.dir.display(),
        panels = images.len(),
        "panelize: loaded images"
    );

    let resolved_theme = args
        .theme
        .as_deref()
        .map(Theme::resolve)
        .transpose()
        .context("loading theme")?;

    // Build config: prefer explicit CLI flags, then theme, then defaults.
    let mut cfg = if let Some(t) = &resolved_theme {
        PanelizeConfig::from_theme(t, args.headline.clone())
    } else {
        PanelizeConfig {
            composition_width: 1920,
            composition_height: 1080,
            frame_rate: 30.0,
            panel_seconds: 1.8,
            crossfade_seconds: 0.4,
            ken_burns_amount: 0.06,
            headline: args.headline.clone(),
            background_hex: [10, 28, 64],
            accent_hex: [240, 200, 60],
            headline_text_hex: [240, 244, 250],
        }
    };
    if let Some(w) = args.width {
        cfg.composition_width = w;
    }
    if let Some(h) = args.height {
        cfg.composition_height = h;
    }
    if let Some(f) = args.fps {
        cfg.frame_rate = f;
    }
    if let Some(ps) = args.panel_seconds {
        cfg.panel_seconds = ps;
    }
    cfg.crossfade_seconds = args.crossfade_seconds;
    cfg.ken_burns_amount = args.ken_burns;
    if args.headline.is_some() {
        cfg.headline = args.headline.clone();
    }

    let lottie = build_panelize_lottie(&images, &cfg)?;
    write_lottie_value(&lottie, &args.out)?;
    tracing::info!(
        out = %args.out.display(),
        panels = images.len(),
        width = cfg.composition_width,
        height = cfg.composition_height,
        fps = cfg.frame_rate,
        panel_seconds = cfg.panel_seconds,
        "panelize: lottie written"
    );

    if let Some(video_out) = &args.out_video {
        let mut r = PythonLottieRenderer::default_in_workspace();
        let render_cfg = RenderConfig {
            width: cfg.composition_width,
            height: cfg.composition_height,
            frame_rate: cfg.frame_rate as f64,
            bitrate_kbps: 6000,
            codec: Codec::H264,
        };
        r.render(&args.out, video_out, &render_cfg)?;
        tracing::info!(out = %video_out.display(), "panelize: mp4 rendered");
    }
    Ok(())
}

fn cmd_themes() -> Result<()> {
    use motion_forge_style_extract::Theme;
    let slugs = Theme::list_bundled_slugs();
    if slugs.is_empty() {
        println!(
            "(no bundled themes found — set MOTION_FORGE_THEMES_DIR or run from the workspace root)"
        );
        return Ok(());
    }
    println!("Available themes:");
    for slug in &slugs {
        match Theme::load_bundled(slug) {
            Ok(t) => println!(
                "  {:<14} {}  ({}x{}@{}fps, {}s default)\n    {}",
                slug,
                t.name,
                t.composition.width,
                t.composition.height,
                t.composition.frame_rate,
                t.default_duration_seconds,
                t.description
            ),
            Err(e) => println!("  {slug:<14} (failed to load: {e})"),
        }
    }
    Ok(())
}

async fn cmd_figma_import(
    url: String,
    node_id_override: Option<String>,
    kind: String,
    token: String,
    out: PathBuf,
) -> Result<()> {
    use motion_forge_figma::{ImportKind, fetch_frame, parse_figma_url, to_lottie_layer};

    let parsed = parse_figma_url(&url).with_context(|| format!("parsing Figma URL {url}"))?;
    let node_id = node_id_override
        .or(parsed.node_id.clone())
        .ok_or_else(|| anyhow::anyhow!("no --node-id provided and URL has no node-id param"))?;
    let import_kind = match kind.to_ascii_lowercase().as_str() {
        "character" | "sprite" => ImportKind::Character,
        "scene" | "background" => ImportKind::Scene,
        other => anyhow::bail!("--kind must be `character` or `scene`, got {other:?}"),
    };
    tracing::info!(
        file_key = %parsed.file_key,
        node_id = %node_id,
        kind = ?import_kind,
        "figma: fetching frame"
    );
    let node = fetch_frame(&parsed.file_key, &node_id, &token).await?;
    let converted = to_lottie_layer(&node);
    let envelope = serde_json::json!({
        "file_key": parsed.file_key,
        "node_id": node_id,
        "kind": match import_kind {
            ImportKind::Character => "character",
            ImportKind::Scene => "scene",
        },
        "source_name": node.name,
        "source_type": node.node_type,
        "layer": converted.layer,
        "warnings": converted.warnings,
    });
    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::write(&out, serde_json::to_string_pretty(&envelope)?)
        .with_context(|| format!("writing {}", out.display()))?;
    tracing::info!(
        out = %out.display(),
        warnings = converted.warnings.len(),
        "figma: layer written"
    );
    if !converted.warnings.is_empty() {
        for w in &converted.warnings {
            tracing::warn!(node = %w.node_id, kind = ?w.kind, "{}", w.message);
        }
    }
    Ok(())
}

// ---- helpers ----

fn derive_work_dir(out: &std::path::Path, label: &str) -> PathBuf {
    let parent = out
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    let stem = out.file_stem().and_then(|s| s.to_str()).unwrap_or(label);
    parent.join(format!("{stem}-work"))
}

fn workspace_root() -> Result<PathBuf> {
    // Walk up from CARGO_MANIFEST_DIR (the cli crate) to the workspace root.
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for _ in 0..5 {
        if p.join("Cargo.toml").exists() && p.join("crates").exists() {
            return Ok(p);
        }
        if !p.pop() {
            break;
        }
    }
    Err(anyhow::anyhow!("could not locate workspace root"))
}
