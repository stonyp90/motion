# motion-forge-ingest

Unified ingestion adapters for popular motion-design source formats. The
crate's job is to flatten any of these inputs into our internal
`Composition` (the Lottie-shaped timeline the orchestrator already
produces). Everything downstream — renderer, panelizer, lottie-gen — stays
format-agnostic.

| Format            | Status            | Notes                                                |
|-------------------|-------------------|------------------------------------------------------|
| Lottie            | Full              | Pass-through                                         |
| Bodymovin         | Full + warnings   | Strips AE-isms (expressions, time-remap, effects)    |
| dotLottie         | Full              | Reads `manifest.json`, extracts active animation     |
| Rive (binary)     | Errors clearly    | `.riv` parser isn't open-source — re-export as JSON  |
| Rive (text JSON)  | Full              | `File > Export > Animation Data (JSON)`              |
| DragonBones       | Full              | One armature → one shot; slots → layers              |
| MoGRT (Premiere)  | Full              | Zip unwrap → embedded Bodymovin → Lottie pipeline    |
| After Effects     | Via Bodymovin     | See below                                             |
| AEP (binary)      | **Out of scope**  | No open-source parser; use Bodymovin path            |

## After Effects → Lottie via Bodymovin (recommended)

After Effects has no exporter we can read directly, but the free
**Bodymovin** plugin produces Lottie JSON that motion-forge ingests
natively. This is by far the highest-fidelity Adobe → motion-forge path —
Bodymovin has been the de-facto standard for shipping AE animations to the
web for years, so most AE artists already have it installed.

1. Install Bodymovin: open After Effects → `Window > Find Extensions on
   Exchange...` → search **Bodymovin** → click `Install`. (Mac users may
   need to enable AE scripting: `Preferences > Scripting & Expressions >
   Allow Scripts to Write Files and Access Network`.)
2. Open your composition in After Effects.
3. `Window > Extensions > Bodymovin`. The Bodymovin panel appears.
4. In the panel, find your composition in the list and tick its checkbox.
5. Click the row's `...` button → choose a **Destination** folder for the
   `.json` output.
6. Click the green **Render** button at the top of the panel.
7. Bodymovin writes a Lottie `.json` (and an `images/` folder if your comp
   uses raster assets). Pass that `.json` to motion-forge:

   ```sh
   motion-forge ingest --format=lottie --in=path/to/your-comp.json \
       --out=internal-composition.json
   ```

## After Effects → motion-forge JSX (alternative)

If you don't want a dependency on Bodymovin (or you want a tighter, more
opinionated export aligned with motion-forge's vocabulary), use the JSX
script shipped at `engine/scripts/motion-forge-export.jsx`:

1. Copy `motion-forge-export.jsx` to AE's scripts folder OR keep it
   anywhere on disk.
2. `File > Scripts > Run Script File...` → select `motion-forge-export.jsx`.
3. The script prompts for an output path and writes a JSON file in
   motion-forge's internal `Composition` shape.
4. Pass it to motion-forge:

   ```sh
   motion-forge ingest --format=after-effects-jsx --in=exported.json \
       --out=internal-composition.json
   ```

## Premiere Pro → MoGRT

Premiere's Motion Graphics Templates (`.mogrt`) embed an AE composition as
Bodymovin JSON. motion-forge unzips the `.mogrt`, finds the embedded
composition, and runs it through the Lottie adapter:

```sh
motion-forge ingest --format=mogrt --in=lower-thirds.mogrt \
    --out=internal-composition.json
```

## Rive

The binary `.riv` format has no open-source parser. To use a Rive file with
motion-forge:

1. Open the file in the Rive editor.
2. `File > Export > Animation Data (JSON)`.
3. Pass the resulting `.json` to motion-forge:

   ```sh
   motion-forge ingest --format=rive --in=hero.json \
       --out=internal-composition.json
   ```

## DragonBones

Pass the `_ske.json` skeleton file directly:

```sh
motion-forge ingest --format=dragon-bones --in=hero_ske.json \
    --out=internal-composition.json
```

## API

```rust
use motion_forge_ingest::{detect, ingest, SourceFormat};

let bytes = std::fs::read("input.json")?;
let format = detect(&bytes).unwrap_or(SourceFormat::Lottie);
let composition = ingest(format, &bytes).await?;
```

`detect()` sniffs magic bytes and the JSON shape; if it returns `None` the
caller should require the user to specify `--format` explicitly.
