// Drawing routines shared by the on-screen preview and the exported tiles.

import { mmToPx, placementRect } from './layout.js';

/** Map poster millimeters to canvas pixels for the preview. */
export function computeView(canvasW, canvasH, layout, pad = 28) {
  const scale = Math.min((canvasW - 2 * pad) / layout.posterW, (canvasH - 2 * pad) / layout.posterH);
  return {
    scale,
    ox: (canvasW - layout.posterW * scale) / 2,
    oy: (canvasH - layout.posterH * scale) / 2,
    x: (mm) => (canvasW - layout.posterW * scale) / 2 + mm * scale,
    y: (mm) => (canvasH - layout.posterH * scale) / 2 + mm * scale,
  };
}

/** Convert a canvas point back to poster millimeters. */
export function viewToPoster(view, px, py) {
  return { x: (px - view.ox) / view.scale, y: (py - view.oy) / view.scale };
}

/**
 * Move the context into the artwork's rotated frame and report the box to fill.
 * Stays synchronous so callers keep full control of save/restore ordering: an
 * `await` between transform and restore would leak the transform to later draws.
 * Callers must wrap the call in ctx.save() / ctx.restore().
 */
function applyPlacementTransform(ctx, dest, rot) {
  const swapped = rot % 180 !== 0;
  const uw = swapped ? dest.h : dest.w;
  const uh = swapped ? dest.w : dest.h;
  ctx.translate(dest.x + dest.w / 2, dest.y + dest.h / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.translate(-uw / 2, -uh / 2);
  return { uw, uh };
}

/** Where the artwork lands on one sheet, in that sheet's canvas pixels. */
function destOnTile(placement, layout, tile, pxPerMm) {
  const rect = placementRect(placement);
  return {
    x: (layout.margin + rect.x - tile.x0) * pxPerMm,
    y: (layout.margin + rect.y - tile.y0) * pxPerMm,
    w: rect.w * pxPerMm,
    h: rect.h * pxPerMm,
  };
}

/** Rasterise one sheet of the poster at `dpi`, ready to embed in the PDF. */
export async function renderTile(source, placement, layout, tile, dpi, { transparent = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(mmToPx(layout.pageW, dpi)));
  canvas.height = Math.max(1, Math.round(mmToPx(layout.pageH, dpi)));
  const ctx = canvas.getContext('2d', { alpha: transparent });
  const pxPerMm = canvas.width / layout.pageW;

  if (!transparent) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Artwork never bleeds into the printer's unusable margin.
  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.margin * pxPerMm, layout.margin * pxPerMm,
           layout.printW * pxPerMm, layout.printH * pxPerMm);
  ctx.clip();
  ctx.imageSmoothingQuality = 'high';
  const { uw, uh } = applyPlacementTransform(ctx, destOnTile(placement, layout, tile, pxPerMm), placement.rot);
  await source.drawInto(ctx, uw, uh);
  ctx.restore();

  return canvas;
}

/**
 * The canvas palette lives in css/app.css as custom properties, so the preview
 * follows the OS color scheme through exactly the same variables as the panel.
 * Looked up once and cached; call refreshTheme() when the scheme changes.
 */
let cachedTheme = null;

export function refreshTheme() {
  cachedTheme = null;
}

function palette(element) {
  if (cachedTheme) return cachedTheme;
  const style = getComputedStyle(element);
  const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  cachedTheme = {
    workspace: read('--canvas-workspace', '#15161c'),
    outside: read('--canvas-outside', 'rgba(14, 15, 20, 0.66)'),
    empty: read('--canvas-empty', '#2a2c36'),
    posterEdge: read('--canvas-poster-edge', '#f2f3f7'),
    halo: read('--canvas-halo', 'rgba(10, 12, 18, 0.8)'),
    guideDark: read('--canvas-guide-dark', 'rgba(10, 12, 18, 0.8)'),
    guideLight: read('--canvas-guide-light', 'rgba(255, 255, 255, 0.96)'),
    seam: read('--canvas-seam', 'rgb(125, 193, 255)'),
    overlap: read('--canvas-overlap', 'rgba(94, 168, 255, 0.18)'),
    handle: read('--canvas-handle', '#5ea8ff'),
    chip: read('--canvas-chip', 'rgba(10, 12, 18, 0.78)'),
    chipText: read('--canvas-chip-text', 'rgba(255, 255, 255, 0.92)'),
    blankWash: read('--canvas-blank-wash', 'rgba(20, 22, 30, 0.45)'),
    blankHatch: read('--canvas-blank-hatch', 'rgba(255, 196, 107, 0.35)'),
  };
  return cachedTheme;
}

/**
 * Stroke the current path twice with interleaved dashes: dark in the gaps of
 * light. A single translucent color cannot stay visible over both a white PDF
 * page and a dark photo — this can. Both passes are theme-independent for that
 * reason; only the chrome around the poster follows the color scheme.
 */
function dualDash(ctx, theme, lightColor, dash = 5, width = 1) {
  ctx.lineWidth = width;
  ctx.setLineDash([dash, dash]);
  ctx.lineDashOffset = 0;
  ctx.strokeStyle = theme.guideDark;
  ctx.stroke();
  ctx.lineDashOffset = dash;
  ctx.strokeStyle = lightColor;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
}

/**
 * Solid line over a wider halo. The halo is light in the light theme and dark in
 * the dark theme, so the pair always contains one of each.
 */
function halo(ctx, theme, drawPath, color, width = 1.5) {
  ctx.strokeStyle = theme.halo;
  ctx.lineWidth = width + 2;
  drawPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  drawPath();
}

/** Draw the whole editing surface: artwork, poster, sheet grid, handles. */
export function drawPreview(canvas, { source, placement, layout, showGrid = true, selected = true, freeAspect = false, markBlank = true }) {
  const ctx = canvas.getContext('2d');
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const theme = palette(canvas);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = theme.workspace;
  ctx.fillRect(0, 0, w, h);

  const view = computeView(w, h, layout);
  const px = (mm) => view.ox + mm * view.scale;
  const py = (mm) => view.oy + mm * view.scale;
  const poster = {
    x: px(0), y: py(0),
    w: layout.posterW * view.scale,
    h: layout.posterH * view.scale,
  };

  // Paper.
  ctx.fillStyle = source ? '#ffffff' : theme.empty;
  ctx.fillRect(poster.x, poster.y, poster.w, poster.h);

  if (source && placement) {
    const rect = placementRect(placement);
    const dest = {
      x: px(rect.x), y: py(rect.y),
      w: rect.w * view.scale, h: rect.h * view.scale,
    };
    ctx.imageSmoothingQuality = 'high';
    ctx.save();
    const { uw, uh } = applyPlacementTransform(ctx, dest, placement.rot);
    ctx.drawImage(source.preview, 0, 0, uw, uh);
    ctx.restore();

    // Everything outside the poster is only a placement aid.
    ctx.fillStyle = theme.outside;
    ctx.fillRect(0, 0, w, poster.y);
    ctx.fillRect(0, poster.y + poster.h, w, h - poster.y - poster.h);
    ctx.fillRect(0, poster.y, poster.x, poster.h);
    ctx.fillRect(poster.x + poster.w, poster.y, w - poster.x - poster.w, poster.h);

    if (markBlank) drawBlankSheets(ctx, theme, layout, placement, px, py, view.scale);
    if (showGrid) drawSheetGrid(ctx, theme, layout, px, py, view.scale);
    if (selected) drawHandles(ctx, theme, dest, freeAspect);
  } else if (showGrid) {
    drawSheetGrid(ctx, theme, layout, px, py, view.scale);
  }

  halo(ctx, theme, () => ctx.strokeRect(poster.x - 0.75, poster.y - 0.75, poster.w + 1.5, poster.h + 1.5),
       theme.posterEdge, 1.5);

  return { view, poster };
}

function drawSheetGrid(ctx, theme, layout, px, py, scale) {
  // Glue flaps: the strips two neighboring sheets both print.
  if (layout.overlap > 0.05) {
    ctx.fillStyle = theme.overlap;
    for (let c = 1; c < layout.cols; c++) {
      ctx.fillRect(px(c * layout.advX), py(0), layout.overlap * scale, layout.posterH * scale);
    }
    for (let r = 1; r < layout.rows; r++) {
      ctx.fillRect(px(0), py(r * layout.advY), layout.posterW * scale, layout.overlap * scale);
    }
  }

  ctx.beginPath();
  for (let c = 1; c < layout.cols; c++) {
    for (const mm of [c * layout.advX, c * layout.advX + layout.overlap]) {
      const x = Math.round(px(mm)) + 0.5;
      ctx.moveTo(x, py(0));
      ctx.lineTo(x, py(layout.posterH));
    }
  }
  for (let r = 1; r < layout.rows; r++) {
    for (const mm of [r * layout.advY, r * layout.advY + layout.overlap]) {
      const y = Math.round(py(mm)) + 0.5;
      ctx.moveTo(px(0), y);
      ctx.lineTo(px(layout.posterW), y);
    }
  }
  dualDash(ctx, theme, layout.overlap > 0.05 ? theme.seam : theme.guideLight);

  // Sheet labels, when there is room for them. They sit on a dark chip so they
  // stay readable over pale artwork as well as over the empty poster.
  const cell = Math.min(layout.advX, layout.advY) * scale;
  if (cell > 42) {
    ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'top';
    for (const tile of layout.tiles) {
      const x = px(tile.x0) + 5;
      const y = py(tile.y0) + 5;
      const w = ctx.measureText(tile.label).width;
      ctx.fillStyle = theme.chip;
      ctx.beginPath();
      ctx.roundRect(x, y, w + 10, 16, 4);
      ctx.fill();
      ctx.fillStyle = theme.chipText;
      ctx.fillText(tile.label, x + 5, y + 3);
    }
  }
}

/**
 * Hatch the sheets the artwork never reaches. The panel names them in the export
 * summary, but that is three sections away from the scale control that causes
 * them, and often below the fold. This puts the warning under the drag.
 */
function drawBlankSheets(ctx, theme, layout, placement, px, py, scale) {
  const blanks = new Set(blankTiles(layout, placement));
  if (!blanks.size || blanks.size === layout.tiles.length) return;

  for (const tile of layout.tiles) {
    if (!blanks.has(tile.label)) continue;
    const x = px(tile.x0);
    const y = py(tile.y0);
    const w = layout.printW * scale;
    const h = layout.printH * scale;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = theme.blankWash;
    ctx.fillRect(x, y, w, h);

    // Diagonal hatching reads as "no artwork here" at any zoom, and survives
    // both themes because it is drawn over the wash, not over the artwork.
    ctx.strokeStyle = theme.blankHatch;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let offset = -h; offset < w; offset += 9) {
      ctx.moveTo(x + offset, y + h);
      ctx.lineTo(x + offset + h, y);
    }
    ctx.stroke();
    ctx.restore();
  }
}

/** Sheets the artwork never reaches — they would print blank. */
export function blankTiles(layout, placement) {
  if (!placement) return layout.tiles.map((t) => t.label);
  const art = placementRect(placement);
  return layout.tiles
    .filter((t) => !(art.x < t.x0 + layout.printW && art.x + art.w > t.x0 &&
                     art.y < t.y0 + layout.printH && art.y + art.h > t.y0))
    .map((t) => t.label);
}

export const HANDLE_SIZE = 9;

/**
 * The resize handles of the placed artwork, in canvas pixels.
 *
 * The four corners are always there. The four edge midpoints appear only when
 * `free` is true, because they change one dimension and leave the other one
 * alone, which has no meaning while the ratio is locked.
 *
 * Each handle carries what a drag needs: `ax` and `ay` tell which axes it
 * resizes, `anchor` is the point that stays still, and `sx`/`sy` give the
 * direction from that anchor.
 */
export function handlePoints(dest, free = false) {
  const { x, y, w, h } = dest;
  const x1 = x + w;
  const y1 = y + h;
  const mx = x + w / 2;
  const my = y + h / 2;

  const points = [
    { id: 'nw', x,      y,      ax: 1, ay: 1, sx: -1, sy: -1, anchor: [x1, y1], cursor: 'nwse-resize' },
    { id: 'ne', x: x1,  y,      ax: 1, ay: 1, sx:  1, sy: -1, anchor: [x,  y1], cursor: 'nesw-resize' },
    { id: 'se', x: x1,  y: y1,  ax: 1, ay: 1, sx:  1, sy:  1, anchor: [x,  y],  cursor: 'nwse-resize' },
    { id: 'sw', x,      y: y1,  ax: 1, ay: 1, sx: -1, sy:  1, anchor: [x1, y],  cursor: 'nesw-resize' },
  ];
  if (free) {
    points.push(
      { id: 'n', x: mx, y,      ax: 0, ay: 1, sx:  0, sy: -1, anchor: [mx, y1], cursor: 'ns-resize' },
      { id: 's', x: mx, y: y1,  ax: 0, ay: 1, sx:  0, sy:  1, anchor: [mx, y],  cursor: 'ns-resize' },
      { id: 'w', x,     y: my,  ax: 1, ay: 0, sx: -1, sy:  0, anchor: [x1, my], cursor: 'ew-resize' },
      { id: 'e', x: x1, y: my,  ax: 1, ay: 0, sx:  1, sy:  0, anchor: [x,  my], cursor: 'ew-resize' },
    );
  }
  return points;
}

function drawHandles(ctx, theme, dest, free) {
  const s = HANDLE_SIZE;
  halo(ctx, theme, () => ctx.strokeRect(dest.x, dest.y, dest.w, dest.h), theme.handle, 1.5);
  for (const point of handlePoints(dest, free)) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(point.x - s / 2, point.y - s / 2, s, s);
    halo(ctx, theme, () => ctx.strokeRect(point.x - s / 2, point.y - s / 2, s, s), theme.handle, 1.5);
  }
}
