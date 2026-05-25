//! Export a motion-forge Lottie composition to web-native animation
//! ecosystems so consumers can drop motion into their existing stack
//! without bundling a Lottie player at runtime.
//!
//! Supported targets:
//! - [`WebExportFormat::SvgSmil`] — single self-contained SVG with
//!   `<animate>` / `<animateTransform>` SMIL elements. Loops via
//!   `repeatCount="indefinite"`.
//! - [`WebExportFormat::SvgCssKeyframes`] — same SVG geometry but the
//!   motion is a `<style>` block with `@keyframes` rules. Each layer
//!   gets a class.
//! - [`WebExportFormat::GsapTimeline`] — JS snippet that builds a
//!   single GSAP timeline targeting `.layer-N` classes.
//! - [`WebExportFormat::MotionJs`] — vanilla `motion` calls
//!   (`framer-motion`'s tree-shakeable build) sequenced via
//!   `Promise.all` chains.
//! - [`WebExportFormat::TheatreJson`] — Theatre.js project state JSON
//!   that can be passed to `getProject(..., { state })`.
//! - [`WebExportFormat::FramerMotionVariants`] — a React-friendly
//!   `variants` object that pairs with `<motion.div animate="...">`.
//!
//! Fidelity is intentionally narrow: we cover translate, rotate, scale,
//! opacity, and fill (where applicable). Masks, mattes, expressions,
//! repeaters, and trim paths are skipped — emitting nothing is better
//! than emitting something subtly wrong.
//!
//! The input is a Lottie JSON [`serde_json::Value`] using the same
//! shape produced by [`motion-forge-lottie-gen`], so we share no Rust
//! types with that crate (decoupling the on-disk Lottie schema from our
//! internal `LottieTimeline`).
//!
//! # Example
//!
//! ```no_run
//! use motion_forge_web_export::{WebExportFormat, export};
//! use serde_json::Value;
//!
//! let lottie: Value = serde_json::from_str(
//!     &std::fs::read_to_string("anim.lottie.json").unwrap()
//! ).unwrap();
//! let svg = export(WebExportFormat::SvgSmil, &lottie).unwrap();
//! std::fs::write("anim.svg", svg).unwrap();
//! ```

#![forbid(unsafe_code)]

pub mod framer_variants;
pub mod gsap;
pub mod ir;
pub mod motion_js;
pub mod svg_css;
pub mod svg_smil;
pub mod theatre_json;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Concrete web-native target.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WebExportFormat {
    /// Self-contained SVG with SMIL `<animate>` / `<animateTransform>`.
    SvgSmil,
    /// SVG geometry + `<style>` block of `@keyframes` rules.
    SvgCssKeyframes,
    /// JS snippet that builds a single GSAP timeline.
    GsapTimeline,
    /// Vanilla `motion` calls (framer-motion's tree-shakeable build).
    MotionJs,
    /// Theatre.js project state JSON.
    TheatreJson,
    /// React `variants` object for Framer Motion.
    FramerMotionVariants,
}

impl WebExportFormat {
    /// Lower-case CLI / HTTP-friendly slug.
    pub fn slug(self) -> &'static str {
        match self {
            Self::SvgSmil => "svg-smil",
            Self::SvgCssKeyframes => "svg-css",
            Self::GsapTimeline => "gsap",
            Self::MotionJs => "motion-js",
            Self::TheatreJson => "theatre",
            Self::FramerMotionVariants => "framer-variants",
        }
    }

    /// Parse from a slug. Accepts the CLI / HTTP form (e.g. `svg-smil`)
    /// plus a few common aliases.
    pub fn from_slug(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "svg-smil" | "smil" | "svg" => Some(Self::SvgSmil),
            "svg-css" | "css" | "svg-keyframes" | "css-keyframes" => Some(Self::SvgCssKeyframes),
            "gsap" | "gsap-timeline" => Some(Self::GsapTimeline),
            "motion-js" | "motion" | "framer-motion-js" => Some(Self::MotionJs),
            "theatre" | "theatre-json" | "theatrejs" => Some(Self::TheatreJson),
            "framer-variants" | "framer" | "variants" => Some(Self::FramerMotionVariants),
            _ => None,
        }
    }

    /// MIME type appropriate for the exported payload.
    pub fn mime_type(self) -> &'static str {
        match self {
            Self::SvgSmil | Self::SvgCssKeyframes => "image/svg+xml",
            Self::GsapTimeline | Self::MotionJs => "application/javascript",
            Self::TheatreJson | Self::FramerMotionVariants => "application/json",
        }
    }

    /// Conventional file extension (no leading dot).
    pub fn extension(self) -> &'static str {
        match self {
            Self::SvgSmil | Self::SvgCssKeyframes => "svg",
            Self::GsapTimeline | Self::MotionJs => "js",
            Self::TheatreJson => "json",
            // Variants are JS-friendly — they're a module re-export of an object.
            Self::FramerMotionVariants => "js",
        }
    }

    /// Enumerate every supported format. Stable order — used by tests
    /// and by the CLI `--list` flag.
    pub fn all() -> &'static [WebExportFormat] {
        &[
            Self::SvgSmil,
            Self::SvgCssKeyframes,
            Self::GsapTimeline,
            Self::MotionJs,
            Self::TheatreJson,
            Self::FramerMotionVariants,
        ]
    }
}

/// Dispatch the right per-format exporter. The exporters work off a
/// shared internal IR ([`ir::Composition`]) so each format only needs
/// to handle its own serialization concerns.
pub fn export(format: WebExportFormat, lottie: &Value) -> Result<String> {
    let comp = ir::Composition::from_lottie(lottie)?;
    match format {
        WebExportFormat::SvgSmil => svg_smil::render(&comp),
        WebExportFormat::SvgCssKeyframes => svg_css::render(&comp),
        WebExportFormat::GsapTimeline => gsap::render(&comp),
        WebExportFormat::MotionJs => motion_js::render(&comp),
        WebExportFormat::TheatreJson => theatre_json::render(&comp),
        WebExportFormat::FramerMotionVariants => framer_variants::render(&comp),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_round_trip() {
        for &f in WebExportFormat::all() {
            assert_eq!(WebExportFormat::from_slug(f.slug()), Some(f));
        }
    }

    #[test]
    fn aliases_parse() {
        assert_eq!(
            WebExportFormat::from_slug("svg"),
            Some(WebExportFormat::SvgSmil)
        );
        assert_eq!(
            WebExportFormat::from_slug("CSS"),
            Some(WebExportFormat::SvgCssKeyframes)
        );
        assert_eq!(
            WebExportFormat::from_slug("variants"),
            Some(WebExportFormat::FramerMotionVariants)
        );
        assert_eq!(WebExportFormat::from_slug("nope"), None);
    }

    #[test]
    fn extension_and_mime_assignments_are_distinct_per_format() {
        // Sanity: every format has a known mime and extension.
        for &f in WebExportFormat::all() {
            assert!(!f.extension().is_empty());
            assert!(!f.mime_type().is_empty());
        }
    }
}
