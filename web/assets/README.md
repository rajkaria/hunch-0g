# Brand assets

Marks for **Hunch** (the operator) and **0G Arena** (the venue), as flat SVG.

| File | What it is |
| --- | --- |
| `hunch-mark.svg` | Hunch mark — lime tile, ink `H`. The primary Hunch mark. |
| `hunch-mark-outline.svg` | Same mark, lime on transparent, for single-colour placements. |
| `hunch-wordmark.svg` | `Hunch` wordmark alone, paper. |
| `hunch-logo.svg` | Mark + wordmark lockup for dark backgrounds. |
| `hunch-logo-on-light.svg` | The same lockup with an ink wordmark, for light backgrounds. |
| `hunch-icon.svg` | Hunch app icon — 512², dark tile, violet bloom, lime `H` tile. |
| `arena-mark.svg` | 0G Arena mark — violet tile, ink bridge. Same tile as the Hunch mark. |
| `arena-mark-outline.svg` | Same bridge, violet on transparent, for single-colour placements. |
| `arena-logo.svg` | Arena mark + `0G ARENA` wordmark. |
| `arena-by-hunch.svg` | Co-brand lockup: `0G ARENA │ BY [H] Hunch`. |
| `arena-app-icon.svg` | Full-bleed 512² app icon; source for `apple-touch-icon.png`. |
| `og-card.svg` | 1200×630 social card; source for `/og.png`. |

## Colours

| Token | Hex | Use |
| --- | --- | --- |
| Lime | `#CBFF5D` | Hunch. The mark, the operator's accent, CTAs that hand you to Hunch. |
| Ink | `#0B0B0F` / `#09090C` | The `H` inside the lime tile; text on lime. |
| Paper | `#FAFAF7` | The Hunch wordmark on dark. |
| Violet | `#C4B5FD` → `#8B5CF6` | 0G Arena. The mark's tile, headings, Arena CTAs. |
| Arena text | `#F2EFFA` | Wordmark and body copy on the Arena near-black. |

The split is the whole system: **Arena is violet, Hunch is lime.** A lime element
on this site always means "this is Hunch" — the mark in the nav, the operator
line in the footer, the `Hunch is live ↗` and `Visit playhunch.xyz` buttons.

The two marks are built on one chassis: the same rounded tile (radius `27/96`),
the same ink glyph, the same optical weight. Hunch's tile is lime and holds an
`H`; Arena's is violet and holds a **bridge** — a suspension span, for the 0G
Bridge the arena is built on. Side by side they read as one family, and either
one alone still says which side of the family it is.

## Type

Every glyph in these files is an outline, so nothing depends on a font being
installed or loaded — they render identically in `<img>`, in Figma, and in a
rasteriser.

- `Hunch` — Inter 900, `-0.02em`, matching the wordmark in the Hunch app.
- `0G ARENA` — Space Grotesk 700, `+0.04em`.
- Labels (`BY`, `OPERATED BY`, pills) — JetBrains Mono 600.

Sources are the self-hosted subsets in `../fonts/` (Fontsource; Inter and
JetBrains Mono are OFL, Space Grotesk is OFL).

## Using them

Reference them by path — they are served immutable for a year (see
`../vercel.json`):

```html
<img src="/assets/hunch-mark.svg" alt="" width="21" height="21" />
```

Where the mark and the wordmark sit side by side in HTML, the page draws the
mark from `hunch-mark.svg` and sets the word in live Inter 900 (`.hunch-word`)
so it inherits colour and hover state. `hunch-logo.svg` is the fixed lockup for
everywhere else.
