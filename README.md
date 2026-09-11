# Poster Generator

Turn one image or PDF page into a large poster split across many printable
sheets. Everything runs in your browser on your own machine — no upload, no
network calls, no telemetry. The page works with Wi-Fi switched off.

**[Try it →](https://sorny.github.io/poster-generator/)**

| Dark | Light |
|---|---|
| ![Poster Generator, dark theme](docs/screenshot-dark.png) | ![Poster Generator, light theme](docs/screenshot-light.png) |

The theme follows your operating system automatically.

---

## Vibe coded

This repository was built by [Claude Code](https://claude.com/claude-code) from a
single seed prompt. No file was written by hand. The prompt, verbatim:

> Lets write a website where i can upload a PDF or any image so I can generate a
> PDF for printing as a poster? The website should run completly local, I want to
> be able to configure how wide the "poster should be" in terms of pages, if
> landspace or portrait, and i want to be able to move and place the uploaded
> image around on the "poster area". go

Everything below — the tiling maths, the interactive canvas, the PDF exporter,
the test suite, this README — came out of that one sentence.

Four follow-up prompts refined it afterwards, each one a single line:

| # | Prompt | What changed |
|---|--------|--------------|
| 1 | *"the grid overlay should always be visible, even when the PDF has a white background"* | Guides became a dark pass plus a light pass, so they read on any artwork |
| 2 | *"should we also support us letter sizes used for printing?"* | US sheet presets and a millimetre/inch unit system |
| 3 | *"write a claude.md file so we can pick up work at any time"* | `CLAUDE.md`, and the test suite moved into the repo |
| 4 | *"now lets commit everything to a git repo…"* | Licence, CI, Pages, this README |
| 5 | *"also add a light theme, make it based on the os preference if thats possible?"* | `prefers-color-scheme` palette shared by the panel and the canvas |

The interesting part is not that it works — it is that the model found three of
its own bugs while testing, and pushed back once. Prompt 2 asked whether US
Letter should be supported; Letter, Legal and Tabloid were already there, so the
honest answer was "yes, and they have been since the start — the real gap is that
everything else is metric." That is where the unit system came from.

## Run it locally

```bash
npm start          # serves http://localhost:8173
```

A dependency-free Node static server bound to `127.0.0.1`. Any other static
server works too (`python3 -m http.server 8173`). A server is needed only
because the app is built from ES modules, which browsers refuse to load over
`file://`.

`npm install` is optional — pdf.js and pdf-lib are committed in `vendor/`. Run it
only to refresh them, then `npm run vendor` to copy the new builds across.

## What it does

**Artwork** — drop in a PNG, JPEG, WebP, GIF or PDF. Multi-page PDFs get a page
picker. PDF artwork stays vector all the way to the exported file, so it is sharp
at any poster size.

**Poster size** — choose how many sheets across and down, the sheet size and
portrait or landscape. The panel shows the finished poster as you change things.

Sheet presets cover ISO A5–A2 and the US sizes: Half Letter, Executive, Letter,
Legal, Tabloid/Ledger, Arch B and Super B (13 × 19 in), all stored as their exact
inch equivalents — a Letter sheet exports as a 612 × 792 pt page. Ledger is
Tabloid with the orientation switch, so it is not a separate entry. Anything else
goes in as a custom size.

Switch **Units** between millimetres and inches. It changes only what you read
and type, never the geometry: presets relabel (`Letter — 8.5 × 11 in`), custom
sizes and artwork dimensions are entered in that unit, and the margin and overlap
sliders snap to sixteenths of an inch instead of half millimetres, so `0.25"` and
`0.5"` are exact.

- *Printer margin* — the border your printer cannot reach. Artwork never enters it.
- *Glue overlap* — how much artwork neighbouring sheets both print. Set it to `0`
  to trim the margins and butt the sheets edge to edge; set it to `10–15 mm`
  (about `½"`) if you would rather cut one sheet along the seam line and glue it
  over its neighbour.

**Placement** — drag the artwork on the canvas, pull a corner handle to resize,
scroll to zoom towards the pointer, nudge with the arrow keys (hold Shift for
10 mm steps). Or type an exact width. `Fit` puts the whole artwork inside the
poster, `Fill` covers the poster and crops the overflow, and `⟲ ⟳` rotate in 90°
steps.

The panel reports the effective print resolution and warns when a bitmap is being
stretched below 150 dpi, so you find out before you print. It also names any
sheets that would come out blank.

**Theme** — light and dark, chosen from your OS setting via `prefers-color-scheme`.
The preview canvas reads the same CSS custom properties as the panel, so both
switch together. The guides drawn over your artwork deliberately do *not* follow
the theme: they are always one dark pass plus one light pass, because the artwork's
colour has nothing to do with your OS setting.

**Output** — pick 150 to 600 dpi and JPEG or PNG. The exported PDF has one page
per sheet in reading order, and optionally:

- *cut and seam guides* — a dashed trim box with corner ticks, plus blue seam
  lines marking the glue flaps;
- *sheet labels* — `A1`, `A2`, `B1` … printed in the margin with row and column;
- *assembly map* — a first page showing how the sheets tile together.

## How the tiling works

All geometry is in millimetres (`js/layout.js`). Each sheet prints
`pageW − 2 × margin` of artwork. Neighbours share `overlap` mm, so the poster
advances by `printW − overlap` per column:

```
posterW = cols × (printW − overlap) + overlap
```

At export time each sheet is rendered on its own (`js/renderer.js`): the canvas
is page-sized, clipped to the printable box, and the artwork is drawn translated
by that sheet's poster offset. Nothing ever allocates a canvas the size of the
whole poster, so a 6 × 4 poster at 600 dpi uses no more memory than a single
sheet. For PDF artwork the vector renderer re-runs per sheet at that sheet's
scale instead of resampling a bitmap.

## Tests

```bash
npm test              # every suite
npm test units        # one suite by name
```

There is no test framework. `test/cdp.js` drives a headless Chrome over the
DevTools Protocol using Node's built-in WebSocket, so the suite has zero
dependencies and tests the real app in a real browser — including reading pixels
back out of rendered sheets and parsing the exported PDF.

| Suite | Checks |
|---|---|
| `tiling` | Every sheet carries its own region of the artwork, margins stay white, glue overlaps match on both neighbours, PDF vector path and rotation |
| `guides` | Grid contrast measured against white, black and mid-grey artwork |
| `theme` | Panel and canvas invert together, and guides keep contrast in both schemes |
| `units` | Sheet presets, mm/inch conversion, and that a unit switch never moves geometry |
| `e2e` | Upload, drag, relayout, multi-page PDF, export, then the PDF read back |

## Layout

```
index.html          markup
css/app.css         styles
js/layout.js        page presets, poster geometry, fit maths
js/source.js        loads images and PDF pages behind one interface
js/renderer.js      preview canvas + per-sheet rasterisation
js/exporter.js      builds the PDF, guides, labels, assembly map
js/app.js           state, pointer interaction, wiring
server.js           local static server
test/               headless-browser suite (no framework)
vendor/             pdf.js and pdf-lib, committed so the app runs offline
```

## Printing tips

- Print at 100% / "actual size". Any "fit to page" or "shrink oversized pages"
  option will scale the sheets and the seams will not line up.
- Set the printer margin to match your printer. 10 mm (about `⅜"`) is safe for
  most inkjets; many lasers need 12–15 mm (`½"`). US printers commonly use `¼"`.
- Check one sheet before committing to all of them.

## Licence

MIT — see [LICENSE](LICENSE).

pdf.js and pdf-lib are vendored under `vendor/` and carry their own licences
(Apache-2.0 and MIT respectively).
