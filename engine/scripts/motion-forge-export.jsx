// motion-forge-export.jsx
// ExtendScript exporter for After Effects → motion-forge.
//
// Dumps the active composition as a JSON file in motion-forge's internal
// Composition shape (see engine/crates/prompt-orchestrator/src/lib.rs ::
// LottieTimeline). This is an alternative to the Bodymovin → Lottie path
// when you want a tighter, opinionated export aligned with our vocabulary.
//
// Usage:
//   1. After Effects > File > Scripts > Run Script File...
//   2. Pick this file.
//   3. The script writes a JSON next to your AE project; pass it to:
//        motion-forge ingest --format=after-effects-jsx --in=<the-json>
//
// Compatible with AE 2020 and later. Pure ExtendScript — no extra plugins.

(function () {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
        alert("motion-forge export: select a composition first.");
        return;
    }

    var savePath = comp.file
        ? comp.file.path + "/" + comp.name + ".motion-forge.json"
        : Folder.desktop.fsName + "/" + comp.name + ".motion-forge.json";

    var output = {
        composition_width: Math.round(comp.width),
        composition_height: Math.round(comp.height),
        duration_seconds: Number(comp.duration),
        frame_rate: Number(comp.frameRate),
        background_hex: rgbTriple(comp.bgColor),
        shots: [
            {
                start_seconds: 0,
                duration_seconds: Number(comp.duration),
                description: "Exported from After Effects via motion-forge-export.jsx",
                layers: collectLayers(comp)
            }
        ]
    };

    var f = new File(savePath);
    f.encoding = "UTF-8";
    f.open("w");
    f.write(JSON.stringify(output, null, 2));
    f.close();
    alert("motion-forge export saved to:\n" + savePath);

    function collectLayers(comp) {
        var out = [];
        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            if (!layer.enabled) continue;

            var kind = "Rect";
            if (layer instanceof TextLayer) kind = "Text";
            else if (layer.source && layer.source.mainSource &&
                     layer.source.mainSource instanceof FileSource) kind = "Image";

            var keyframes = sampleKeyframes(layer, comp.frameRate, comp.duration);
            out.push({
                name: layer.name,
                kind: kind,
                fill_hex: null,
                stroke_hex: null,
                text: kind === "Text"
                    ? String(layer.property("Source Text").value.text)
                    : null,
                keyframes: keyframes
            });
        }
        return out;
    }

    function sampleKeyframes(layer, fps, duration) {
        // Sample every 0.25s — coarse enough to keep the JSON small,
        // fine enough that downstream interpolation looks AE-like.
        var step = 0.25;
        var out = [];
        for (var t = 0; t <= duration + 0.001; t += step) {
            var pos = layer.transform.position.valueAtTime(t, false);
            var opacity = layer.transform.opacity.valueAtTime(t, false);
            var rot = layer.transform.rotation
                ? layer.transform.rotation.valueAtTime(t, false)
                : 0;
            out.push({
                time_seconds: Number(t.toFixed(3)),
                position: [Number(pos[0]), Number(pos[1])],
                size: [100.0, 100.0],
                rotation_degrees: Number(rot),
                opacity: Number(opacity) / 100,
                easing_label: "Standard"
            });
        }
        return out;
    }

    function rgbTriple(color) {
        if (!color) return [10, 10, 10];
        return [
            Math.round(color[0] * 255),
            Math.round(color[1] * 255),
            Math.round(color[2] * 255)
        ];
    }
})();
