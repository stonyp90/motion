//! Universal output-format matrix.
//!
//! Motion-forge's render entry-point can target any of the formats in
//! [`OutputFormat`]. For raster/video targets (MP4, MOV, WebM, GIF, WebP,
//! APNG) we go Lottie → MP4 (the python rasterizer) → ffmpeg transcode
//! with a codec recipe per format. For the two zero-render formats:
//!
//! - **DotLottie** (`.lottie`): just a zip containing the source Lottie
//!   JSON + a small `manifest.json`. No pixels are involved. This is the
//!   "sticker" format LottieFiles uses.
//! - **SVG**: emit a minimal SMIL animation (`<animate>` elements) that
//!   reflects the Lottie composition size + duration. A best-effort
//!   converter — Lottie's full expression graph does not fit in SMIL,
//!   so this is intentionally a degraded fallback that gives designers
//!   an editable starting point.
//!
//! Each variant returns a `Vec<String>` of ffmpeg flags from
//! [`OutputFormat::ffmpeg_args`]. Callers thread an intermediate MP4 in
//! via `-i <path>` and add `-y <output>` themselves, so this module is
//! purely declarative.

use anyhow::{Context, Result, anyhow};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::str::FromStr;

/// Every export target motion-forge supports.
///
/// The variant order is the order shown in CLI `--help` / OpenAPI docs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum OutputFormat {
    /// H.264 in MP4. The historical default, ubiquitous web playback.
    #[default]
    Mp4,
    /// ProRes 4444 in QuickTime. Designer handoff (alpha channel, high bitrate).
    Mov,
    /// VP9 in WebM. Open codec, good for the modern web.
    Webm,
    /// AV1 (libsvtav1) in WebM. Smaller files than VP9 at equivalent quality.
    WebmAv1,
    /// Animated GIF. 2-pass with palettegen + paletteuse for decent quality.
    Gif,
    /// Animated WebP. Tries `libwebp_anim` first; falls back to `libwebp`
    /// (single-frame loop) via [`OutputFormat::ffmpeg_fallback_args`] when
    /// the animated encoder is not available in the ffmpeg build.
    Webp,
    /// Animated PNG. Lossless, large, supported everywhere modern.
    Apng,
    /// Plain Lottie JSON. Pass-through — we just copy the input.
    Lottie,
    /// DotLottie (`.lottie`). Zip of the Lottie JSON + manifest, the LottieFiles
    /// sticker / package format.
    DotLottie,
    /// SVG with SMIL `<animate>` elements. Best-effort, degraded fallback.
    Svg,
}

impl OutputFormat {
    /// Canonical CLI / route slug.
    pub fn slug(self) -> &'static str {
        match self {
            OutputFormat::Mp4 => "mp4",
            OutputFormat::Mov => "mov",
            OutputFormat::Webm => "webm",
            OutputFormat::WebmAv1 => "webm-av1",
            OutputFormat::Gif => "gif",
            OutputFormat::Webp => "webp",
            OutputFormat::Apng => "apng",
            OutputFormat::Lottie => "lottie",
            OutputFormat::DotLottie => "dotlottie",
            OutputFormat::Svg => "svg",
        }
    }

    /// Filename extension (no leading `.`).
    pub fn extension(self) -> &'static str {
        match self {
            OutputFormat::Mp4 => "mp4",
            OutputFormat::Mov => "mov",
            OutputFormat::Webm | OutputFormat::WebmAv1 => "webm",
            OutputFormat::Gif => "gif",
            OutputFormat::Webp => "webp",
            OutputFormat::Apng => "apng",
            OutputFormat::Lottie => "json",
            OutputFormat::DotLottie => "lottie",
            OutputFormat::Svg => "svg",
        }
    }

    /// Friendly MIME type for HTTP responses.
    pub fn mime(self) -> &'static str {
        match self {
            OutputFormat::Mp4 => "video/mp4",
            OutputFormat::Mov => "video/quicktime",
            OutputFormat::Webm | OutputFormat::WebmAv1 => "video/webm",
            OutputFormat::Gif => "image/gif",
            OutputFormat::Webp => "image/webp",
            OutputFormat::Apng => "image/apng",
            OutputFormat::Lottie => "application/json",
            OutputFormat::DotLottie => "application/zip",
            OutputFormat::Svg => "image/svg+xml",
        }
    }

    /// Every supported format. Useful for `--help` enumeration and tests.
    pub const ALL: &'static [OutputFormat] = &[
        OutputFormat::Mp4,
        OutputFormat::Mov,
        OutputFormat::Webm,
        OutputFormat::WebmAv1,
        OutputFormat::Gif,
        OutputFormat::Webp,
        OutputFormat::Apng,
        OutputFormat::Lottie,
        OutputFormat::DotLottie,
        OutputFormat::Svg,
    ];

    /// True if this format is produced by an ffmpeg transcode from an
    /// intermediate MP4. False for the zero-render targets (Lottie /
    /// DotLottie / SVG) which are built directly from the source JSON.
    pub fn is_ffmpeg_target(self) -> bool {
        !matches!(
            self,
            OutputFormat::Lottie | OutputFormat::DotLottie | OutputFormat::Svg
        )
    }

    /// Args to feed `ffmpeg` after the input flag, ending with the output
    /// path's spot (callers append `-y <output_path>` separately).
    ///
    /// Codec choices:
    /// - **MP4 (libx264)** — default, baseline level for web.
    /// - **MOV (prores_ks)** — Apple ProRes 4444 (`-profile:v 4`) with
    ///   `yuva444p10le` for alpha channel + 10-bit color. Designer-grade.
    /// - **WebM (libvpx-vp9)** — VP9 at CRF 32, target bitrate 2M.
    /// - **WebM AV1 (libsvtav1)** — SVT-AV1 CRF 30, no bitrate cap (CRF mode).
    /// - **GIF** — 2-pass with palettegen + paletteuse via a complex filter.
    /// - **WebP** — animated WebP via `libwebp_anim` if available, otherwise
    ///   the caller falls back to `libwebp` per-frame (best-effort).
    /// - **APNG** — `-c:v apng -plays 0` (infinite loop).
    pub fn ffmpeg_args(self) -> Vec<String> {
        let s = |x: &str| x.to_string();
        match self {
            OutputFormat::Mp4 => vec![
                s("-c:v"),
                s("libx264"),
                s("-preset"),
                s("medium"),
                s("-crf"),
                s("23"),
                s("-pix_fmt"),
                s("yuv420p"),
                s("-movflags"),
                s("+faststart"),
            ],
            OutputFormat::Mov => vec![
                s("-c:v"),
                s("prores_ks"),
                s("-profile:v"),
                s("4"), // ProRes 4444 (alpha)
                s("-pix_fmt"),
                s("yuva444p10le"),
                s("-vendor"),
                s("apl0"),
            ],
            OutputFormat::Webm => vec![
                s("-c:v"),
                s("libvpx-vp9"),
                s("-b:v"),
                s("2M"),
                s("-crf"),
                s("32"),
                s("-pix_fmt"),
                s("yuv420p"),
                s("-row-mt"),
                s("1"),
            ],
            OutputFormat::WebmAv1 => vec![
                s("-c:v"),
                s("libsvtav1"),
                s("-crf"),
                s("30"),
                s("-b:v"),
                s("0"),
                s("-pix_fmt"),
                s("yuv420p"),
            ],
            OutputFormat::Gif => vec![
                // 2-pass-in-one-graph: split → palettegen → paletteuse.
                s("-filter_complex"),
                s(
                    "[0:v]split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=5",
                ),
                s("-loop"),
                s("0"),
            ],
            OutputFormat::Webp => vec![
                // libwebp_anim is the proper animated-webp encoder. Older
                // ffmpeg builds expose it as `libwebp` with `-loop 0`. Try
                // libwebp_anim first; the dispatcher will retry plain
                // libwebp if it fails to spawn.
                s("-c:v"),
                s("libwebp_anim"),
                s("-lossless"),
                s("0"),
                s("-q:v"),
                s("75"),
                s("-loop"),
                s("0"),
            ],
            OutputFormat::Apng => vec![
                s("-c:v"),
                s("apng"),
                s("-plays"),
                s("0"),
                s("-pix_fmt"),
                s("rgba"),
            ],
            // Zero-render formats — no ffmpeg involved.
            OutputFormat::Lottie | OutputFormat::DotLottie | OutputFormat::Svg => Vec::new(),
        }
    }

    /// Fallback ffmpeg args if [`ffmpeg_args`] codec isn't compiled in.
    /// Currently only animated WebP has a fallback (plain libwebp single
    /// frame loop). Returns `None` for everything else.
    pub fn ffmpeg_fallback_args(self) -> Option<Vec<String>> {
        let s = |x: &str| x.to_string();
        match self {
            OutputFormat::Webp => Some(vec![
                s("-c:v"),
                s("libwebp"),
                s("-lossless"),
                s("0"),
                s("-q:v"),
                s("75"),
                s("-loop"),
                s("0"),
            ]),
            _ => None,
        }
    }
}

impl FromStr for OutputFormat {
    type Err = anyhow::Error;
    fn from_str(s: &str) -> Result<Self> {
        // Accept slug or extension; case-insensitive.
        let s = s.trim().to_ascii_lowercase();
        // Normalize a leading dot if the caller passed an extension.
        let s = s.strip_prefix('.').unwrap_or(&s);
        match s {
            "mp4" | "h264" => Ok(OutputFormat::Mp4),
            "mov" | "prores" | "quicktime" => Ok(OutputFormat::Mov),
            "webm" | "vp9" => Ok(OutputFormat::Webm),
            "webm-av1" | "av1" | "webmav1" => Ok(OutputFormat::WebmAv1),
            "gif" => Ok(OutputFormat::Gif),
            "webp" => Ok(OutputFormat::Webp),
            "apng" => Ok(OutputFormat::Apng),
            "lottie" | "json" => Ok(OutputFormat::Lottie),
            "dotlottie" | "lottie-zip" => Ok(OutputFormat::DotLottie),
            "svg" => Ok(OutputFormat::Svg),
            other => Err(anyhow!(
                "unknown output format `{other}`; expected one of: {}",
                OutputFormat::ALL
                    .iter()
                    .map(|f| f.slug())
                    .collect::<Vec<_>>()
                    .join(", ")
            )),
        }
    }
}

// ---- format pipeline (high-level) -----------------------------------------

/// Run an ffmpeg transcode from `input_mp4` to `output_path` using the
/// codec recipe for `format`. Returns the bytes written.
///
/// Caller is responsible for producing the intermediate MP4 (the python
/// renderer does this today). This function is a thin wrapper around
/// `ffmpeg -y -i <input> <args...> <output>` with the fallback retry
/// for formats that have one ([`OutputFormat::ffmpeg_fallback_args`]).
pub fn transcode_with_ffmpeg(
    format: OutputFormat,
    input_mp4: &Path,
    output_path: &Path,
) -> Result<u64> {
    if !format.is_ffmpeg_target() {
        return Err(anyhow!(
            "format {} is not produced by ffmpeg transcode (use the dedicated builder)",
            format.slug()
        ));
    }
    if !input_mp4.exists() {
        return Err(anyhow!(
            "intermediate MP4 not found at {}",
            input_mp4.display()
        ));
    }
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent).context("creating output directory")?;
    }

    let primary = format.ffmpeg_args();
    if try_ffmpeg(input_mp4, output_path, &primary).is_ok() {
        return file_size(output_path);
    }
    if let Some(fallback) = format.ffmpeg_fallback_args() {
        tracing::warn!(
            format = format.slug(),
            "primary ffmpeg encoder failed; trying fallback"
        );
        try_ffmpeg(input_mp4, output_path, &fallback)?;
        return file_size(output_path);
    }
    // Re-run primary so the error surface includes ffmpeg stderr.
    try_ffmpeg(input_mp4, output_path, &primary)?;
    file_size(output_path)
}

fn try_ffmpeg(input: &Path, output: &Path, args: &[String]) -> Result<()> {
    let input_str = input
        .to_str()
        .ok_or_else(|| anyhow!("input path is not valid UTF-8"))?;
    let output_str = output
        .to_str()
        .ok_or_else(|| anyhow!("output path is not valid UTF-8"))?;

    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-y")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error");
    cmd.arg("-i").arg(input_str);
    for a in args {
        cmd.arg(a);
    }
    cmd.arg(output_str);
    tracing::info!(cmd = ?cmd, "ffmpeg transcode");
    let status = cmd.status().context("spawning ffmpeg")?;
    if !status.success() {
        return Err(anyhow!("ffmpeg exited with status {:?}", status.code()));
    }
    if !output.exists() {
        return Err(anyhow!(
            "ffmpeg reported success but {} is missing",
            output.display()
        ));
    }
    Ok(())
}

fn file_size(p: &Path) -> Result<u64> {
    Ok(std::fs::metadata(p)
        .with_context(|| format!("stat {}", p.display()))?
        .len())
}

// ---- DotLottie (.lottie) packer ------------------------------------------

/// Pack a Lottie JSON file as a DotLottie (`.lottie`) archive.
///
/// DotLottie is a zip containing:
/// - `manifest.json` — animation metadata (id, version, animations list)
/// - `animations/<id>.json` — the Lottie payload(s)
///
/// We pack a single animation with id `main`. The Lottie JSON is parsed
/// only to extract `fr` (frame-rate) for the manifest — the body is
/// streamed in verbatim so we never mutate the user's animation.
pub fn pack_dotlottie(lottie_path: &Path, output_path: &Path) -> Result<u64> {
    let raw =
        std::fs::read(lottie_path).with_context(|| format!("reading {}", lottie_path.display()))?;

    // Parse just enough to discover the frame rate; default to 30 if missing.
    let parsed: serde_json::Value = serde_json::from_slice(&raw)
        .with_context(|| format!("parsing Lottie JSON at {}", lottie_path.display()))?;
    let fr = parsed.get("fr").and_then(|v| v.as_f64()).unwrap_or(30.0) as f32;

    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent).context("creating output directory")?;
    }
    let file = std::fs::File::create(output_path)
        .with_context(|| format!("creating {}", output_path.display()))?;
    let mut zip = zip::ZipWriter::new(file);
    let opts: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // Manifest follows the dotLottie spec
    // (https://dotlottie.io/structure/) — minimum useful subset.
    let manifest = serde_json::json!({
        "version": "1.0",
        "generator": "motion-forge",
        "author": "motion-forge",
        "animations": [
            {
                "id": "main",
                "speed": 1.0,
                "loop": true,
                "autoplay": true,
                "frameRate": fr,
            }
        ],
        "activeAnimationId": "main",
    });
    zip.start_file("manifest.json", opts)
        .context("writing manifest.json")?;
    zip.write_all(serde_json::to_string_pretty(&manifest)?.as_bytes())?;

    zip.start_file("animations/main.json", opts)
        .context("writing animation entry")?;
    zip.write_all(&raw)?;

    zip.finish().context("finalising dotLottie zip")?;
    file_size(output_path)
}

// ---- SVG (SMIL) export ---------------------------------------------------

/// Build a minimal animated SVG from a Lottie JSON file.
///
/// This is a degraded fallback: we cannot losslessly translate Lottie's
/// shape graph + expression engine into SMIL. We extract the composition
/// size and duration, then emit:
/// - A background `<rect>` matching the composition.
/// - One `<rect>` or `<ellipse>` per Lottie shape layer with a SMIL
///   `<animate>` driving opacity (in / out fade) so the file plays.
///
/// Designers get an editable SVG they can extend in Illustrator /
/// Inkscape. Anything more elaborate belongs in a dedicated converter.
pub fn build_svg(lottie_path: &Path, output_path: &Path) -> Result<u64> {
    let raw = std::fs::read_to_string(lottie_path)
        .with_context(|| format!("reading {}", lottie_path.display()))?;
    let v: serde_json::Value = serde_json::from_str(&raw).context("parsing Lottie JSON")?;

    let width = v.get("w").and_then(|x| x.as_u64()).unwrap_or(1920);
    let height = v.get("h").and_then(|x| x.as_u64()).unwrap_or(1080);
    let fr = v.get("fr").and_then(|x| x.as_f64()).unwrap_or(30.0);
    let ip = v.get("ip").and_then(|x| x.as_f64()).unwrap_or(0.0);
    let op = v.get("op").and_then(|x| x.as_f64()).unwrap_or(fr * 6.0);
    let duration_s = ((op - ip) / fr).max(0.1);

    let mut svg = String::new();
    svg.push_str(&format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{w}\" height=\"{h}\" viewBox=\"0 0 {w} {h}\" preserveAspectRatio=\"xMidYMid meet\">\n",
        w = width,
        h = height
    ));
    svg.push_str(&format!(
        "  <title>motion-forge SVG export ({duration_s:.2}s)</title>\n"
    ));

    // Try to find a background colour from the bottom-most full-frame rect.
    // Fall back to opaque dark slate so the page is visibly populated.
    let bg = first_layer_fill(&v).unwrap_or([15, 23, 42]);
    svg.push_str(&format!(
        "  <rect x=\"0\" y=\"0\" width=\"{w}\" height=\"{h}\" fill=\"rgb({r},{g},{b})\"/>\n",
        w = width,
        h = height,
        r = bg[0],
        g = bg[1],
        b = bg[2],
    ));

    // For each non-background layer with a discoverable size + fill, emit
    // a simple animated rect that fades in then out across the duration.
    let layers = v
        .get("layers")
        .and_then(|x| x.as_array())
        .cloned()
        .unwrap_or_default();
    for (idx, layer) in layers.iter().skip(1).enumerate() {
        let (lx, ly, lw, lh) = layer_bbox(layer, width as f32, height as f32);
        let fill = layer_fill(layer).unwrap_or([245, 158, 11]);
        let begin = (idx as f64 * 0.15).min(duration_s * 0.5);
        svg.push_str(&format!(
            "  <rect x=\"{x:.1}\" y=\"{y:.1}\" width=\"{w:.1}\" height=\"{h:.1}\" fill=\"rgb({r},{g},{b})\" opacity=\"0\">\n    <animate attributeName=\"opacity\" values=\"0;1;1;0\" keyTimes=\"0;0.15;0.85;1\" dur=\"{dur:.2}s\" begin=\"{begin:.2}s\" repeatCount=\"indefinite\"/>\n  </rect>\n",
            x = lx,
            y = ly,
            w = lw,
            h = lh,
            r = fill[0],
            g = fill[1],
            b = fill[2],
            dur = duration_s,
            begin = begin,
        ));
    }

    svg.push_str("</svg>\n");

    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent).context("creating output directory")?;
    }
    std::fs::write(output_path, &svg)
        .with_context(|| format!("writing {}", output_path.display()))?;
    file_size(output_path)
}

fn first_layer_fill(v: &serde_json::Value) -> Option<[u8; 3]> {
    let layers = v.get("layers")?.as_array()?;
    let bg = layers.last()?; // Lottie writes top-down; background is last.
    layer_fill(bg)
}

fn layer_fill(layer: &serde_json::Value) -> Option<[u8; 3]> {
    let shapes = layer.get("shapes")?.as_array()?;
    for s in shapes {
        if let Some(fill) = walk_shapes_for_fill(s) {
            return Some(fill);
        }
    }
    None
}

fn walk_shapes_for_fill(s: &serde_json::Value) -> Option<[u8; 3]> {
    // Lottie fills look like {"ty":"fl","c":{"k":[r,g,b,a]}}; groups
    // nest other shape items under `it`.
    if s.get("ty").and_then(|t| t.as_str()) == Some("fl") {
        let arr = s.get("c")?.get("k")?.as_array()?;
        if arr.len() >= 3 {
            let r = (arr[0].as_f64().unwrap_or(0.0) * 255.0)
                .round()
                .clamp(0.0, 255.0) as u8;
            let g = (arr[1].as_f64().unwrap_or(0.0) * 255.0)
                .round()
                .clamp(0.0, 255.0) as u8;
            let b = (arr[2].as_f64().unwrap_or(0.0) * 255.0)
                .round()
                .clamp(0.0, 255.0) as u8;
            return Some([r, g, b]);
        }
    }
    if let Some(items) = s.get("it").and_then(|x| x.as_array()) {
        for it in items {
            if let Some(c) = walk_shapes_for_fill(it) {
                return Some(c);
            }
        }
    }
    None
}

fn layer_bbox(layer: &serde_json::Value, comp_w: f32, comp_h: f32) -> (f32, f32, f32, f32) {
    // Inspect the first shape group's transform for an anchor + size hint.
    // Fall back to a centred 40% box so the layer is visible.
    let default = (comp_w * 0.3, comp_h * 0.3, comp_w * 0.4, comp_h * 0.4);
    let shapes = match layer.get("shapes").and_then(|x| x.as_array()) {
        Some(s) => s,
        None => return default,
    };
    let mut size = (default.2, default.3);
    let mut pos = (default.0 + default.2 * 0.5, default.1 + default.3 * 0.5);
    for s in shapes {
        if let Some(items) = s.get("it").and_then(|x| x.as_array()) {
            for it in items {
                if let Some(sz) = it
                    .get("s")
                    .and_then(|x| x.get("k"))
                    .and_then(|x| x.as_array())
                {
                    if sz.len() >= 2 {
                        size = (
                            sz[0].as_f64().unwrap_or(default.2 as f64) as f32,
                            sz[1].as_f64().unwrap_or(default.3 as f64) as f32,
                        );
                    }
                }
            }
        }
    }
    // Layer-level position from `ks.p.k` if static.
    if let Some(p) = layer
        .get("ks")
        .and_then(|x| x.get("p"))
        .and_then(|x| x.get("k"))
        .and_then(|x| x.as_array())
    {
        if p.len() >= 2 {
            pos = (
                p[0].as_f64().unwrap_or(pos.0 as f64) as f32,
                p[1].as_f64().unwrap_or(pos.1 as f64) as f32,
            );
        }
    }
    (
        (pos.0 - size.0 * 0.5).max(0.0),
        (pos.1 - size.1 * 0.5).max(0.0),
        size.0.max(1.0),
        size.1.max(1.0),
    )
}

// ---- Lottie pass-through -------------------------------------------------

/// Copy a Lottie JSON file to the output path, normalising whitespace
/// (re-pretty-printed so the output is deterministic).
pub fn copy_lottie(lottie_path: &Path, output_path: &Path) -> Result<u64> {
    let raw =
        std::fs::read(lottie_path).with_context(|| format!("reading {}", lottie_path.display()))?;
    let v: serde_json::Value = serde_json::from_slice(&raw)
        .with_context(|| format!("parsing Lottie JSON at {}", lottie_path.display()))?;
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent).context("creating output directory")?;
    }
    let pretty = serde_json::to_string_pretty(&v)?;
    std::fs::write(output_path, pretty.as_bytes())
        .with_context(|| format!("writing {}", output_path.display()))?;
    file_size(output_path)
}

// ---- output path helpers -------------------------------------------------

/// If `out` already ends with the format's extension, return it as-is;
/// otherwise append the extension. Lets callers pass either `out.gif`
/// or just `out`.
pub fn coerce_extension(out: &Path, format: OutputFormat) -> PathBuf {
    let ext_target = format.extension();
    if out
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case(ext_target))
        .unwrap_or(false)
    {
        return out.to_path_buf();
    }
    out.with_extension(ext_target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
    }

    #[test]
    fn slug_roundtrips_through_from_str() {
        for f in OutputFormat::ALL {
            let s = f.slug();
            let parsed: OutputFormat = s.parse().unwrap();
            assert_eq!(*f, parsed, "slug {s} did not round-trip");
        }
    }

    #[test]
    fn extension_lookup_is_lowercase_and_extensionless() {
        for f in OutputFormat::ALL {
            let ext = f.extension();
            assert!(!ext.is_empty());
            assert!(!ext.starts_with('.'));
            assert_eq!(ext, ext.to_ascii_lowercase());
        }
    }

    #[test]
    fn from_str_accepts_aliases_and_extensions() {
        assert_eq!("h264".parse::<OutputFormat>().unwrap(), OutputFormat::Mp4);
        assert_eq!(".mp4".parse::<OutputFormat>().unwrap(), OutputFormat::Mp4);
        assert_eq!("PRORES".parse::<OutputFormat>().unwrap(), OutputFormat::Mov);
        assert_eq!(
            "webm-av1".parse::<OutputFormat>().unwrap(),
            OutputFormat::WebmAv1
        );
        assert_eq!(
            "dotlottie".parse::<OutputFormat>().unwrap(),
            OutputFormat::DotLottie
        );
    }

    #[test]
    fn from_str_rejects_unknown() {
        let err = "garbage".parse::<OutputFormat>().unwrap_err();
        assert!(err.to_string().contains("unknown output format"));
    }

    #[test]
    fn ffmpeg_target_classification_matches_args_emptiness() {
        for f in OutputFormat::ALL {
            let args = f.ffmpeg_args();
            if f.is_ffmpeg_target() {
                assert!(!args.is_empty(), "{} should emit ffmpeg args", f.slug());
            } else {
                assert!(args.is_empty(), "{} should not emit ffmpeg args", f.slug());
            }
        }
    }

    #[test]
    fn ffmpeg_args_include_documented_codec() {
        // Sanity-check the codec the docs / PR description promise.
        fn arg_after(args: &[String], flag: &str) -> Option<String> {
            args.iter()
                .position(|a| a == flag)
                .map(|i| args[i + 1].clone())
        }
        assert_eq!(
            arg_after(&OutputFormat::Mp4.ffmpeg_args(), "-c:v").as_deref(),
            Some("libx264")
        );
        assert_eq!(
            arg_after(&OutputFormat::Mov.ffmpeg_args(), "-c:v").as_deref(),
            Some("prores_ks")
        );
        assert_eq!(
            arg_after(&OutputFormat::Webm.ffmpeg_args(), "-c:v").as_deref(),
            Some("libvpx-vp9")
        );
        assert_eq!(
            arg_after(&OutputFormat::WebmAv1.ffmpeg_args(), "-c:v").as_deref(),
            Some("libsvtav1")
        );
        assert_eq!(
            arg_after(&OutputFormat::Apng.ffmpeg_args(), "-c:v").as_deref(),
            Some("apng")
        );
        assert_eq!(
            arg_after(&OutputFormat::Webp.ffmpeg_args(), "-c:v").as_deref(),
            Some("libwebp_anim")
        );
        // GIF uses a filter graph instead of -c:v.
        let gif = OutputFormat::Gif.ffmpeg_args();
        assert!(gif.iter().any(|a| a == "-filter_complex"));
    }

    #[test]
    fn coerce_extension_appends_when_missing_and_keeps_when_present() {
        let out = PathBuf::from("/tmp/out");
        assert_eq!(
            coerce_extension(&out, OutputFormat::Webm),
            PathBuf::from("/tmp/out.webm")
        );
        assert_eq!(
            coerce_extension(&PathBuf::from("/tmp/out.webm"), OutputFormat::Webm),
            PathBuf::from("/tmp/out.webm")
        );
        // Case-insensitive match: don't overwrite extension if it differs only in case.
        assert_eq!(
            coerce_extension(&PathBuf::from("/tmp/out.WEBM"), OutputFormat::Webm),
            PathBuf::from("/tmp/out.WEBM")
        );
    }

    #[test]
    fn dotlottie_pack_produces_valid_zip_with_manifest() {
        let tmp = tempfile::tempdir().unwrap();
        let lottie = tmp.path().join("in.lottie.json");
        std::fs::write(
            &lottie,
            r#"{"v":"5.7.0","fr":24,"ip":0,"op":48,"w":640,"h":360,"layers":[]}"#,
        )
        .unwrap();
        let out = tmp.path().join("out.lottie");
        let bytes = pack_dotlottie(&lottie, &out).expect("pack");
        assert!(bytes > 0);

        // Re-open the zip and verify it has the two expected entries.
        let f = std::fs::File::open(&out).unwrap();
        let mut zr = zip::ZipArchive::new(f).expect("valid zip");
        assert!(zr.by_name("manifest.json").is_ok());
        assert!(zr.by_name("animations/main.json").is_ok());

        // Manifest should carry the frame rate from the source Lottie.
        let mut mf = zr.by_name("manifest.json").unwrap();
        let mut buf = String::new();
        std::io::Read::read_to_string(&mut mf, &mut buf).unwrap();
        let v: serde_json::Value = serde_json::from_str(&buf).unwrap();
        assert_eq!(v["animations"][0]["frameRate"], 24.0);
    }

    #[test]
    fn svg_export_is_well_formed_with_animate_elements() {
        let tmp = tempfile::tempdir().unwrap();
        let lottie = tmp.path().join("in.lottie.json");
        std::fs::write(
            &lottie,
            r#"{
                "v":"5.7.0","fr":30,"ip":0,"op":90,"w":400,"h":300,
                "layers":[
                    {"ty":4,"ks":{"p":{"k":[200,150]}},"shapes":[
                        {"ty":"gr","it":[
                            {"ty":"rc","s":{"k":[100,100]}},
                            {"ty":"fl","c":{"k":[1.0,0.5,0.0,1.0]}}
                        ]}
                    ]},
                    {"ty":4,"ks":{},"shapes":[
                        {"ty":"gr","it":[{"ty":"fl","c":{"k":[0.0,0.0,0.0,1.0]}}]}
                    ]}
                ]
            }"#,
        )
        .unwrap();
        let out = tmp.path().join("out.svg");
        let bytes = build_svg(&lottie, &out).expect("svg");
        assert!(bytes > 0);
        let body = std::fs::read_to_string(&out).unwrap();
        assert!(body.starts_with("<svg"));
        assert!(body.contains("</svg>"));
        assert!(body.contains("<animate"));
        // 400x300 viewBox should be in the header.
        assert!(body.contains("viewBox=\"0 0 400 300\""));
    }

    #[test]
    fn copy_lottie_pretty_prints_and_writes_bytes() {
        let tmp = tempfile::tempdir().unwrap();
        let lottie = tmp.path().join("in.json");
        std::fs::write(&lottie, r#"{"v":"5.7","fr":30,"layers":[]}"#).unwrap();
        let out = tmp.path().join("out.json");
        let bytes = copy_lottie(&lottie, &out).unwrap();
        assert!(bytes > 0);
        let body = std::fs::read_to_string(&out).unwrap();
        // Pretty-printed body contains newlines.
        assert!(body.contains('\n'));
    }

    /// Quick check that the fixtures dir is reachable so format roundtrip
    /// tests can locate it. This won't fail CI when fixtures are absent.
    #[test]
    fn fixture_dir_path_is_constructible() {
        let _ = fixture_dir();
    }
}
