// Pure tests of js/layout.js. The module has no DOM dependency, so these import
// it directly and run in milliseconds. Everything the poster does geometrically
// comes from here, which makes these the cheapest checks in the repository.

import { main } from './harness.js';
import {
  PAGE_PRESETS, computeLayout, pageSize, placedAspect, placementRect,
  fitPlacement, rowLabel, mmToPt, mmToPx,
} from '../js/layout.js';

export const name = 'geometry';
export const browser = false;

const A4 = { preset: 'a4', orientation: 'portrait', cols: 1, rows: 1, margin: 10, overlap: 0, customW: 210, customH: 297 };
const near = (a, b, tol = 0.001) => Math.abs(a - b) <= tol;

export async function body({ check }) {
  // --- a single sheet: the poster is exactly the printable area
  const one = computeLayout(A4);
  check('1x1 poster equals the printable area',
    near(one.posterW, 190) && near(one.posterH, 277), `${one.posterW} x ${one.posterH}`);
  check('1x1 has no neighbours',
    !one.tiles[0].hasLeft && !one.tiles[0].hasRight && !one.tiles[0].hasTop && !one.tiles[0].hasBottom);

  // --- the overlap identity, over a range of configurations
  let identityHolds = true;
  const cases = [];
  for (const cols of [1, 2, 3, 7]) {
    for (const rows of [1, 2, 5]) {
      for (const overlap of [0, 5, 12.5, 30]) {
        for (const margin of [0, 10, 18]) {
          const l = computeLayout({ ...A4, cols, rows, margin, overlap });
          const w = cols * (l.printW - l.overlap) + l.overlap;
          const h = rows * (l.printH - l.overlap) + l.overlap;
          if (!near(l.posterW, w) || !near(l.posterH, h)) {
            identityHolds = false;
            cases.push(`${cols}x${rows} m${margin} o${overlap}`);
          }
        }
      }
    }
  }
  check('posterW = cols x (printW - overlap) + overlap, for 144 configurations',
    identityHolds, cases.slice(0, 3).join(', '));

  // --- tiles line up edge to edge with no gap and no drift
  const grid = computeLayout({ ...A4, cols: 4, rows: 3, overlap: 15 });
  const lastTile = grid.tiles[grid.tiles.length - 1];
  check('the last tile ends exactly at the poster edge',
    near(lastTile.x0 + grid.printW, grid.posterW) && near(lastTile.y0 + grid.printH, grid.posterH),
    `${lastTile.x0 + grid.printW} vs ${grid.posterW}`);
  check('each column advances by printW - overlap',
    grid.tiles.filter((t) => t.row === 0).every((t, i) => near(t.x0, i * (grid.printW - grid.overlap))));
  check('tile count is cols x rows', grid.tiles.length === 12, String(grid.tiles.length));

  // --- neighbour flags drive which seam lines get drawn
  const corner = grid.tiles[0];
  const opposite = grid.tiles[11];
  check('the first tile has only right and bottom neighbours',
    !corner.hasLeft && corner.hasRight && !corner.hasTop && corner.hasBottom);
  check('the last tile has only left and top neighbours',
    opposite.hasLeft && !opposite.hasRight && opposite.hasTop && !opposite.hasBottom);

  // --- labels
  // 4 columns and 3 rows: columns are numbers, rows are letters, so A1 to C4.
  check('labels read A1 to C4 across a 4-column, 3-row grid',
    grid.tiles[0].label === 'A1' && grid.tiles[3].label === 'A4' && grid.tiles[11].label === 'C4',
    grid.tiles.map((t) => t.label).join(' '));
  check('row labels continue past Z',
    rowLabel(0) === 'A' && rowLabel(25) === 'Z' && rowLabel(26) === 'AA' && rowLabel(27) === 'AB',
    [0, 25, 26, 27].map(rowLabel).join(' '));

  // --- clamping keeps a silly number from producing a negative printable area
  const fatMargin = computeLayout({ ...A4, margin: 500 });
  check('an over-large margin is clamped, printable area stays positive',
    fatMargin.printW > 0 && fatMargin.printH > 0 && fatMargin.margin < 105,
    `margin ${fatMargin.margin}, print ${fatMargin.printW} x ${fatMargin.printH}`);
  const fatOverlap = computeLayout({ ...A4, cols: 3, overlap: 5000 });
  check('an over-large overlap is clamped below the printable width',
    fatOverlap.overlap < fatOverlap.printW && fatOverlap.advX > 0,
    `overlap ${fatOverlap.overlap}, advance ${fatOverlap.advX}`);
  const zero = computeLayout({ ...A4, cols: 0, rows: -4 });
  check('a zero or negative sheet count becomes 1', zero.cols === 1 && zero.rows === 1);

  // --- page sizes
  const letterP = pageSize({ preset: 'letter', orientation: 'portrait' });
  const letterL = pageSize({ preset: 'letter', orientation: 'landscape' });
  check('Letter portrait is 215.9 x 279.4 mm', near(letterP.w, 215.9) && near(letterP.h, 279.4));
  check('landscape swaps the two sides', near(letterL.w, 279.4) && near(letterL.h, 215.9));
  const custom = pageSize({ preset: 'custom', orientation: 'portrait', customW: 400, customH: 150 });
  check('a custom size is normalised to portrait', near(custom.w, 150) && near(custom.h, 400),
    `${custom.w} x ${custom.h}`);

  // --- US presets are exact inch values in points
  const expected = { letter: [612, 792], legal: [612, 1008], tabloid: [792, 1224], superb: [936, 1368], archb: [864, 1296], halfletter: [396, 612], executive: [522, 756] };
  const wrong = Object.entries(expected).filter(([id, [w, h]]) => {
    const [pw, ph] = PAGE_PRESETS[id].size;
    return mmToPt(pw) !== w || mmToPt(ph) !== h;
  });
  check('every US preset is an exact number of points', wrong.length === 0,
    wrong.map(([id]) => id).join(', '));

  check('mmToPx converts at the requested resolution',
    near(mmToPx(25.4, 300), 300) && near(mmToPx(210, 150), 1240.157, 0.01));

  // --- artwork ratio and rotation
  const wide = { width: 1600, height: 1000 };
  check('rotation by 90 degrees inverts the ratio',
    near(placedAspect(wide, 0), 1.6) && near(placedAspect(wide, 90), 0.625)
      && near(placedAspect(wide, 180), 1.6) && near(placedAspect(wide, 270), 0.625));

  // --- fit and fill
  const poster = computeLayout({ ...A4, cols: 2, rows: 2 });   // 380 x 554, ratio 0.686
  const contain = fitPlacement(poster, wide, 0, 'contain');
  check('contain fits inside the poster and touches one edge',
    contain.w <= poster.posterW + 0.01 && contain.h <= poster.posterH + 0.01 && near(contain.w, poster.posterW),
    `${contain.w} x ${contain.h}`);
  const cover = fitPlacement(poster, wide, 0, 'cover');
  check('cover reaches both edges and overflows one',
    cover.w >= poster.posterW - 0.01 && cover.h >= poster.posterH - 0.01 && cover.w > poster.posterW,
    `${cover.w} x ${cover.h}`);
  check('fit and fill both centre the artwork',
    near(contain.cx, poster.posterW / 2) && near(cover.cy, poster.posterH / 2));
  check('contain keeps the artwork ratio', near(contain.w / contain.h, 1.6));

  const stretched = fitPlacement(poster, wide, 0, 'contain', 1.0);
  check('an aspect override wins over the artwork ratio',
    near(stretched.w / stretched.h, 1.0), `${stretched.w} x ${stretched.h}`);

  // --- placementRect is the box the renderer and the blank-sheet test both use
  const rect = placementRect({ cx: 100, cy: 50, w: 40, h: 20 });
  check('placementRect centres the box on cx and cy',
    near(rect.x, 80) && near(rect.y, 40) && near(rect.w, 40) && near(rect.h, 20),
    JSON.stringify(rect));
}

if (process.argv[1]?.endsWith('geometry.test.js')) main(name, body, { browser: false });
