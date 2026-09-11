# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start             # serve the app on http://localhost:8173 (PORT env overrides)
npm test              # every browser suite, one summary
npm test units        # one suite: tiling | guides | units | e2e (substring match)
node test/units.test.js   # same suite, run directly
npm run vendor        # re-copy pdf.js / pdf-lib from node_modules into vendor/
node --check js/app.js    # syntax check; there is no build step or linter
```

`npm install` is **optional**. pdf.js and pdf-lib are committed under `vendor/`,
and the tests parse exported PDFs with that same vendored build, so a clean
checkout runs and tests without touching npm. Install only to refresh `vendor/`.

The app is plain ES modules served as-is — no bundler, no transpiler, no build.
Editing a file and reloading the page is the whole dev loop. A server is required
only because browsers refuse ES modules over `file://`.

Tests need a Chrome on the machine. `test/cdp.js` finds Playwright's cached
"Chrome for Testing", then a normal Chrome install; `CHROME_PATH` overrides.

## Architecture

Six modules, each with one job. The dependency direction is strictly
`app → renderer/exporter → source/layout`; nothing imports `app.js`.

| File | Responsibility |
|---|---|
| `js/layout.js` | Page presets, poster geometry, fit maths. Pure functions, no DOM. |
| `js/source.js` | Wraps an uploaded image or PDF page in one interface. |
| `js/renderer.js` | Draws the interactive preview and rasterises one sheet. |
| `js/exporter.js` | Assembles the PDF: sheets, guides, labels, assembly map. |
| `js/app.js` | State, pointer interaction, DOM wiring. The only module touching the panel. |
| `server.js` | Dependency-free static server, bound to `127.0.0.1`. |

### Millimetres are the only unit

Every stored dimension is mm. Pixels appear only inside a render call
(`mmToPx(mm, dpi)`), points only when writing the PDF (`mmToPt`). The mm/inch
toggle in the UI is a **display layer in `app.js` only** — `UNITS` converts what
the user reads and types, and `state.cfg` stays metric. A unit switch must never
change geometry; `test/units.test.js` asserts a mm → in → mm round trip is exact.

### The tiling model

`computeLayout(cfg)` turns a page setup into tiles. Each sheet prints
`printW = pageW − 2 × margin` of artwork, and neighbours duplicate `overlap` mm,
so the poster advances by `advX = printW − overlap` per column:

```
posterW = cols × advX + overlap
```

Tile `n` starts at poster coordinate `n × advX`. Overlap `0` means trim the
margins and butt the sheets together; a positive overlap gives a glue flap.

### One sheet at a time, never a whole-poster canvas

`renderTile()` allocates a canvas the size of a single **page**, clips to the
printable box, and translates the artwork by that tile's poster offset. A 6 × 4
poster at 600 dpi therefore costs the same memory as one sheet. Do not "simplify"
this by compositing the full poster and slicing it — that allocates gigabytes.

### The source interface

`loadSource(file)` returns `{ kind, width, height, preview, pageCount, drawInto,
selectPage, dispose }`. The contract that matters is `drawInto(ctx, w, h)`: paint
the artwork into the rect `(0,0)–(w,h)` of the **current transform**, at whatever
resolution that transform implies.

- Images call `drawImage` with the source bitmap.
- PDFs re-run the pdf.js vector renderer per sheet at that sheet's scale, so
  output stays sharp at any poster size instead of resampling one raster.

pdf.js multiplies onto the existing context transform rather than replacing it,
which is what makes the same call work for both. `preview` is a cheap bitmap used
only by the interactive canvas.

Teardown detail: `destroy()` lives on the pdf.js *loading task*, not on the
document proxy (which only has `cleanup()`).

## Conventions that exist for a reason

These were all bugs once. Changing them reintroduces the bug.

**Never `await` between a canvas transform and its `restore()`.** The await
resolves in a microtask after the calling function returns, leaking the transform
into later draws. `renderer.js` uses the synchronous `applyPlacementTransform()`
helper, with save/restore owned by the caller, precisely so a transform and its
restore cannot be split by an await.

**Guides are drawn twice, dark then light.** One translucent colour cannot stay
visible on both a white PDF page and a dark photo. `dualDash()` strokes the path
with interleaved dashes (dark at offset 0, light at offset `dash`); `halo()` puts
a wider dark stroke under a solid one. `test/guides.test.js` measures the
resulting contrast against white, black and mid-grey artwork.

**`[hidden]` needs `!important` in `css/app.css`.** Layout rules set
`display: flex/grid` on the same elements and would otherwise beat the user-agent
rule, leaving "hidden" panels visible.

**The margin and overlap sliders use `step="any"` and quantise in JS.** Changing
a range input's `step` attribute makes the browser re-sanitise its *value* to the
new grid — which silently resized the poster when the unit toggle changed the
step. `sliderGrid()` returns the grid; the input handler rounds to it.

**Rotation is 90° steps only.** The placed artwork's bounding box therefore stays
axis-aligned, which is what keeps hit-testing and resize handles trivial.
Arbitrary angles would need a rotated-bbox hit test throughout `app.js`.

## Tests

No test framework. `test/cdp.js` drives headless Chrome over the DevTools
Protocol with Node's built-in `WebSocket`, so the suite has zero dependencies and
exercises the real app in a real browser: it samples pixels out of rendered
sheets and parses the exported PDF.

`test/harness.js` boots `server.js` on a free port per suite and exposes
`check(label, ok, detail)` — assertions record rather than throw, so one failure
does not hide the rest. `test/fixtures.js` builds artwork inside the page, so
there are no binary fixtures on disk.

Suites: `tiling` (pixel-level correctness of the sheet maths), `guides` (contrast
measurement), `units` (presets and the display layer), `e2e` (upload → place →
export → read the PDF back).

One browser gotcha: top-level `const` in `Runtime.evaluate` persists across calls
and collides on the next one. Always use `page.run()` / `page.runAsync()`, which
wrap the snippet in its own function scope.

## Deployment

`.github/workflows/pages.yml` copies `index.html`, `css/`, `js/` and `vendor/`
into `_site` and publishes to GitHub Pages on every push to `main`. There is no
build, so the deployed site is the source. All asset paths are relative, which is
what lets it work from a `/poster-generator/` subpath.

`.github/workflows/ci.yml` syntax-checks every module and runs the browser suite
against the runner's preinstalled Chrome.
