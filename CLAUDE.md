# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start             # serve the app on http://localhost:8173 (PORT overrides the port)
npm test              # all browser suites, one summary
npm test units        # one suite: geometry | tiling | guides | theme | units
                      #            placement | export | ux | e2e  (substring match)
node test/units.test.js   # the same suite, run directly
npm run vendor        # copy pdf.js and pdf-lib from node_modules into vendor/
node --check js/app.js    # syntax check; there is no build step and no linter
```

`npm install` is **optional**. The repository includes pdf.js and pdf-lib in
`vendor/`, and the tests parse exported PDFs with that same vendored build. A
clean checkout thus runs and tests without npm. Use `npm install` only to get
new versions for `vendor/`.

The app is plain ES modules, served as they are. There is no bundler, no
transpiler, and no build. The full development loop is to edit a file and load the
page again. A server is necessary only because browsers refuse ES modules over
`file://`.

The tests need a Chrome on the machine. `test/cdp.js` looks for the cached
"Chrome for Testing" of Playwright, then for a usual Chrome installation. The
`CHROME_PATH` variable overrides this search.

## Architecture

There are six modules, and each module has one task. The dependency direction is
always `app → renderer/exporter → source/layout`. No module imports `app.js`.

| File | Task |
|---|---|
| `js/layout.js` | Page presets, poster geometry, and fit math. Pure functions, no DOM. |
| `js/source.js` | Puts an uploaded image or PDF page behind one interface. |
| `js/renderer.js` | Draws the interactive preview, and rasterizes one sheet. |
| `js/exporter.js` | Builds the PDF: sheets, guides, labels, and the assembly map. |
| `js/app.js` | State, pointer interaction, and DOM wiring. The only module that touches the panel. |
| `server.js` | Static server with no dependencies, bound to `127.0.0.1`. |

### Millimeters are the only unit

Each stored dimension is in millimeters. Pixels occur only in a render call
(`mmToPx(mm, dpi)`). The app uses points only to write the PDF (`mmToPt`).

The millimeter/inch control is a **display layer in `app.js` only**. `UNITS`
converts what the user reads and types, and `state.cfg` stays metric. A unit
change must never change the geometry. `test/units.test.js` makes sure that a
millimeter → inch → millimeter conversion is exact.

### The tiling model

`computeLayout(cfg)` makes tiles from a page setup. Each sheet prints
`printW = pageW − 2 × margin` of artwork. Adjacent sheets duplicate `overlap` mm.
Thus the poster moves forward by `advX = printW − overlap` for each column:

```
posterW = cols × advX + overlap
```

Tile `n` starts at poster coordinate `n × advX`. An overlap of `0` means that the
user cuts off the margins and puts the sheets edge to edge. A larger overlap gives
a glue flap.

### One sheet at a time, never a full-poster canvas

`renderTile()` makes a canvas with the size of one **page**. It clips the canvas
to the printable box. Then it moves the artwork by the poster offset of that tile.
A 6 × 4 poster at 600 dpi thus uses the same memory as one sheet.

CAUTION: Do not replace this method with one large canvas that the code divides
into sheets. One canvas for the full poster needs gigabytes of memory.

### The placement model

`state.placement` is `{ cx, cy, w, h, rot }` in poster millimeters. The width and
the height are both first class.

`state.lockAspect` decides what `setPlacement()` does with the height. With the
lock on, `setPlacement()` computes the height from the width and from the ratio of
the artwork, thus a stretch is impossible. With the lock off, the caller owns both
dimensions.

`activeAspect()` gives the ratio that a fit or a scale keeps. With the lock on, it
is the ratio of the artwork. With the lock off, it is the ratio of the box as it
is now. A layout change or a `Fit` thus does not undo a deliberate stretch.

`handlePoints(dest, free)` in `renderer.js` gives the resize handles. It is the
one source for the drawing and for the hit test. The four edge midpoints appear
only when `free` is true. Each handle carries its anchor point and the axes that
it resizes, thus the drag code needs no special case for each handle.

### Color scheme

`css/app.css` holds the full palette as custom properties on `:root` (dark). One
`@media (prefers-color-scheme: light)` block overrides them. No rule is duplicated
between the two themes. Only the variables change, and `color-scheme` makes the
native controls follow.

The preview canvas reads the same variables. `renderer.js` gets the `--canvas-*`
properties with `getComputedStyle` and caches them. `app.js` listens on
`matchMedia('(prefers-color-scheme: light)')`. When that listener fires, it calls
`refreshTheme()` and then `render()`.

To add a canvas color, add a `--canvas-*` property and read it in `palette()`.
Never write a color into the JavaScript.

The guide colors (`--canvas-guide-dark`, `--canvas-guide-light`, `--canvas-seam`)
do **not** follow the theme. The reason is in "Guides are drawn two times".

### The source interface

`loadSource(file)` gives `{ kind, width, height, preview, pageCount, drawInto,
selectPage, dispose }`. The important part of the contract is
`drawInto(ctx, w, h)`: it draws the artwork into the rectangle `(0,0)–(w,h)` of
the **current transform**, at the resolution that this transform gives.

- For images, `drawInto` calls `drawImage` with the source bitmap.
- For PDFs, the pdf.js vector renderer runs again for each sheet, at the scale of
  that sheet. The output stays sharp at all poster sizes, and the code does not
  resample one raster.

pdf.js multiplies onto the transform that the context already has. It does not
replace that transform. This is why the same call works for both kinds of source.
`preview` is a cheap bitmap, and only the interactive canvas uses it.

Note: `destroy()` belongs to the pdf.js loading task, not to the document proxy.
The document proxy has only `cleanup()`.

## Conventions that exist for a reason

Each item here was a bug one time. If you change the convention, the bug returns.

**Never put an `await` between a canvas transform and its `restore()`.** The
`await` resolves in a microtask after the calling function returns. The transform
then leaks into later draw calls. `renderer.js` uses the synchronous
`applyPlacementTransform()` helper, and the caller owns the save and the restore.
This makes it impossible for an `await` to divide a transform from its restore.

**Guides are drawn two times, dark and then light.** One translucent color cannot
stay visible on a white PDF page and on a dark photo. `dualDash()` strokes the
path with interleaved dashes: dark at offset 0, and light at offset `dash`.
`halo()` puts a wider stroke of the opposite tone under a solid stroke.

This is why the guide colors do not follow the color scheme. The pair must hold
one light stroke and one dark stroke in both themes. The color of the artwork does
not depend on the OS setting. Only `--canvas-halo` and
`--canvas-poster-edge` swap, and they swap together, thus the pair stays complete.
`test/guides.test.js` and `test/theme.test.js` measure this contrast against
white, black, and mid-gray artwork, in both themes.

**`[hidden]` needs `!important` in `css/app.css`.** Layout rules set
`display: flex` or `display: grid` on the same elements. Without `!important`,
those rules win against the user-agent rule, and hidden panels stay visible.

**The margin slider and the overlap slider use `step="any"`, and the code
quantizes their values.** When the `step` attribute of a range input changes, the
browser sanitizes the *value* to the new grid. When the unit control changed the
step, the poster changed size with no warning. `sliderGrid()` gives the grid, and the
input handler rounds to it.

**The mouse wheel does nothing on the canvas.** Wheel zoom was there and it was
removed. It fought with page scrolling on small windows, and the handles already
size the artwork. Do not add it again without a request.

**The header is one bar with `align-items: center`.** It mixes a 20 px icon with
two text sizes. Under `align-items: baseline` the browser lines up text baselines
across that row, which dropped the tagline about 5 px below the title. The sheet
grid toggle and the status line live in this bar; they had their own second bar,
which cost 38 px of canvas for two controls. `test/e2e.test.js` measures that all
five header items share one center line and that no second bar returns.

**A flex item's `flex-basis` beats its `height` on the main axis.** Under 860px
the stage is a column flex container. `.canvaswrap` carried `flex: 1`, which sets
`flex-basis: 0%`, so the `height: 60vh` in the media query never applied and the
canvas computed to 0px tall. The rule there is `flex: none; height: 60vh`. Any
explicit size on a flex item needs the basis released first.

**`input[type="number"]` is more specific than a class.** The attribute selector
scores (0,1,1) and a bare `.num` scores (0,1,0), so the general `width: 100%`
beat the narrow width and squeezed the slider track to nothing. Number inputs
that need their own width match as `input[type="number"].num`.

**Buttons need `:focus-visible` named explicitly.** The reset clears the
user-agent outline, and `button` was missing from the focus rule, so eight
controls had no keyboard focus state. `test/ux.test.js` tabs through the panel
with real key events, because `element.focus()` does not match `:focus-visible`
on a button and would pass a broken page.

**Undo records at the end of a gesture, never during one.** `commit()` pushes a
copy of the placement onto a bounded stack. A drag streams hundreds of
intermediate states; recording them would make one drag take hundreds of undos.
Pointer release, a discrete command, and a pause after a run of arrow keys each
record one step.

**Rotation uses 90° steps only.** The bounding box of the placed artwork thus
stays parallel to the axes, which keeps hit tests and resize handles simple. Free
angles need a rotated-box hit test through all of `app.js`.

## Tests

There is no test framework. `test/cdp.js` operates a headless Chrome over the
DevTools Protocol with the WebSocket client that Node includes. The suite
thus has no dependencies, and it tests the real app in a real browser. It
samples pixels from the rendered sheets, and it parses the exported PDF.

A suite that sets `export const browser = false` runs in Node with no browser,
which is how the `geometry` suite finishes in milliseconds.

`test/harness.js` starts `server.js` on a free port for each suite. It gives
`check(label, ok, detail)`. An assertion records a result and does not throw, thus
one failure does not hide the other results. `test/fixtures.js` builds the artwork
inside the page, thus there are no binary fixtures on disk.

These are the suites:

- The `geometry` suite tests `js/layout.js` directly. It needs no browser.
- The `tiling` suite tests the sheet math at pixel level.
- The `guides` suite measures the contrast of the guides.
- The `theme` suite tests the color scheme with `Emulation.setEmulatedMedia`.
- The `units` suite tests the presets and the display layer.
- The `placement` suite tests the handles and the ratio lock.
- The `export` suite tests the export option matrix.
- The `ux` suite guards the fixes from the interface review.
- The `e2e` suite uploads a file, places it, exports the PDF, then reads the PDF back.

Note: a top-level `const` in `Runtime.evaluate` stays after the call and collides
on the next call. Always use `page.run()` or `page.runAsync()`. These helpers put
the code in its own function scope.

Note: allocate each port with `freePort()`. Deriving one port from another by
arithmetic broke every browser suite at once when the OS started handing out
ephemeral ports above 64535 and the sum passed 65535.

Note: headless Chrome writes a download one time for each file name, and it drops
a later download that carries a name it already wrote. A suite thus cannot export
more than one PDF through the Export button. The `export` suite calls
`buildPosterPdf()` and reads the bytes back. The `e2e` suite covers the button.

Note: pdf-lib deflates the font dictionary into an object stream. A font name is
thus never visible in the raw bytes. Read the page resources instead.

## Deployment

`.github/workflows/pages.yml` copies `index.html`, `css/`, `js/`, and `vendor/`
into `_site`, and publishes to GitHub Pages at each push to `main`. There is no
build step, thus the published site is the source. All asset paths are relative,
which lets the site work from the `/poster-generator/` subpath.

`.github/workflows/ci.yml` does a syntax check of each module, and runs the
browser suite against the Chrome of the runner.
