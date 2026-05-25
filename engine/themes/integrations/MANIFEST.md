# Motion-Forge Integration Logos — Source Manifest

12 single-color SVG marks intended for the motion-forge cast picker. All
files share a `viewBox="0 0 24 24"` and use `fill="currentColor"` so
motion-forge can recolor them via CSS (monochrome cast view, brand-color
view, dark/light theming).

## License summary

All 12 marks were sourced from Simple Icons, which publishes under
**CC0 1.0 Universal** (no attribution required, no warranty). Seven were
fetched from the live CDN (`cdn.simpleicons.org`); five were fetched from
the historical **simple-icons@9** package on jsDelivr because the live
project has since delisted them at the brand owner's request (see caveats
below). The CC0 grant on the v9 release is irrevocable — the assets we
shipped remain freely usable — but if motion-forge ever needs to refresh
them, the project may need an alternative source.

## Files

| id                 | file                    | source                                                                                | brand color |
| ------------------ | ----------------------- | ------------------------------------------------------------------------------------- | ----------- |
| github             | github.svg              | https://cdn.simpleicons.org/github                                                    | #181717     |
| jira               | jira.svg                | https://cdn.simpleicons.org/jira                                                      | #0052CC     |
| linear             | linear.svg              | https://cdn.simpleicons.org/linear                                                    | #5E6AD2     |
| azure-devops       | azure-devops.svg        | https://cdn.jsdelivr.net/npm/simple-icons@9/icons/azuredevops.svg                     | #0078D7     |
| slack              | slack.svg               | https://cdn.jsdelivr.net/npm/simple-icons@9/icons/slack.svg                           | #4A154B     |
| microsoft-teams    | microsoft-teams.svg     | https://cdn.jsdelivr.net/npm/simple-icons@9/icons/microsoftteams.svg                  | #6264A7     |
| microsoft-excel    | microsoft-excel.svg     | https://cdn.jsdelivr.net/npm/simple-icons@9/icons/microsoftexcel.svg                  | #217346     |
| google-calendar    | google-calendar.svg     | https://cdn.simpleicons.org/googlecalendar                                            | #4285F4     |
| notion             | notion.svg              | https://cdn.simpleicons.org/notion                                                    | #000000     |
| figma              | figma.svg               | https://cdn.simpleicons.org/figma                                                     | #F24E1E     |
| zoom               | zoom.svg                | https://cdn.simpleicons.org/zoom                                                      | #0B5CFF     |
| salesforce         | salesforce.svg          | https://cdn.jsdelivr.net/npm/simple-icons@9/icons/salesforce.svg                      | #00A1E0     |

## Normalization

Each SVG was passed through a small Python pass that:

1. Removed any baked-in `fill="#brand"` attribute on the root `<svg>` tag.
2. Inserted `fill="currentColor"` so CSS `color:` propagates to all paths.
3. Stripped per-path `fill="..."` attributes (none were present, but the
   pass is defensive).

The `viewBox`, `xmlns`, and original path data are preserved. Each file
parses cleanly as XML and is under 4 KB (largest is microsoft-teams at
1870 bytes; total 10.5 KB across all 12).

## Brand-guideline caveats

These five brands removed themselves from Simple Icons' active catalog
after the v9 release. The CC0-licensed SVGs we shipped are still free to
use, but the brand owners have asserted trademark restrictions on the
marks themselves. Motion-forge should honor these in product UI:

- **Slack** — Salesforce's brand guidelines say the Slack mark may not be
  recolored (must appear in the official Slack colors or in
  black/white). Our SVG is monochrome by default, which is permitted, but
  the UI should NOT apply arbitrary tint colors to the Slack mark in
  brand-color view; render it in `#4A154B` (aubergine) or white-on-dark.
  Source: https://slack.com/media-kit
- **Microsoft Teams / Microsoft Excel** — Microsoft's trademark
  guidelines forbid modifying the product marks (including
  recoloring). Same posture as Slack: render in the official brand color
  or monochrome black/white; do not apply theme tints to these two in a
  way that misrepresents the product.
  Source: https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks
- **Salesforce** — Trademark guidelines require the cloud icon to appear
  in the official Salesforce blue (#00A1E0) or a single neutral color
  (black/white). No gradients, no recoloring with arbitrary brand tints.
  Source: https://www.salesforce.com/company/legal/intellectual-property/
- **Azure DevOps** — Microsoft's brand site provides only the full-color
  mark. The monochrome silhouette we shipped is a simplified form
  acceptable for navigation/icon use; if a customer-facing surface needs
  the official artwork, link to
  https://learn.microsoft.com/en-us/azure/devops/media/brand-guidelines/
  instead.

**Recommendation for motion-forge UI**: in the cast picker's "brand
color" view, render each mark in its `brand_color` from manifest.json.
In the monochrome cast view, render every mark in `currentColor` (which
is the default behavior of these files). Avoid offering users a free
color picker for the five restricted brands above — gate those to
brand-color or monochrome.

## Verification commands

```bash
cd /tmp/motion-forge-prep/logos
ls -la *.svg                     # all 12 present, all < 4 KB
python3 -c "import xml.etree.ElementTree as ET, glob; [ET.parse(p) for p in glob.glob('*.svg')]; print('all parse OK')"
grep -L 'fill="currentColor"' *.svg   # should print nothing
grep -L 'viewBox="0 0 24 24"' *.svg   # should print nothing
```
