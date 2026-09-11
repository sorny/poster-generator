// Drawing routines shared by the on-screen preview and the exported tiles.

import { mmToPx, placementRect } from './layout.js';

/** Map poster millimetres to canvas pixels for the preview. */
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

/** Convert a canvas point back to poster millimetres. */
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

const THEME = {
  workspace: '#15161c',
  outside: 'rgba(14, 15, 20, 0.66)',
  posterEdge: '#f2f3f7',
  // Guides sit on top of artwork we know nothing about, so every one of them is
  // drawn as a dark pass plus a light pass. Whichever half matches the artwork
  // disappears; the other half carries the line. See dualDash / halo below.
  guideDark: 'rgba(10, 12, 18, 0.8)',
  guideLight: 'rgba(255, 255, 255, 0.96)',
  seamLight: 'rgb(125, 193, 255)',
  overlap: 'rgba(94, 168, 255, 0.18)',
  handle: '#5ea8ff',
  empty: '#2a2c36',
};

/**
 * Stroke the current path twice with interleaved dashes: dark in the gaps of
 * light. A single translucent colour cannot stay visible over both a white PDF
 * page and a dark photo — this can.
 */
function dualDash(ctx, lightColor, dash = 5, width = 1) {
  ctx.lineWidth = width;
  ctx.setLineDash([dash, dash]);
  ctx.lineDashOffset = 0;
  ctx.strokeStyle = THEME.guideDark;
  ctx.stroke();
  ctx.lineDashOffset = dash;
  ctx.strokeStyle = lightColor;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
}

/** Solid line with a dark halo underneath, for the same reason as dualDash. */
function halo(ctx, drawPath, color, width = 1.5) {
  ctx.strokeStyle = THEME.guideDark;
  ctx.lineWidth = width + 2;
  drawPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  drawPath();
}

/** Draw the whole editing surface: artwork, poster, sheet grid, handles. */
export function drawPreview(canvas, { source, placement, layout, showGrid = true, selected = true }) {
  const ctx = canvas.getContext('2d');
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = THEME.workspace;
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
  ctx.fillStyle = source ? '#ffffff' : THEME.empty;
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
    ctx.fillStyle = THEME.outside;
    ctx.fillRect(0, 0, w, poster.y);
    ctx.fillRect(0, poster.y + poster.h, w, h - poster.y - poster.h);
    ctx.fillRect(0, poster.y, poster.x, poster.h);
    ctx.fillRect(poster.x + poster.w, poster.y, w - poster.x - poster.w, poster.h);

    if (showGrid) drawSheetGrid(ctx, layout, px, py, view.scale);
    if (selected) drawHandles(ctx, dest);
  } else if (showGrid) {
    drawSheetGrid(ctx, layout, px, py, view.scale);
  }

  halo(ctx, () => ctx.strokeRect(poster.x - 0.75, poster.y - 0.75, poster.w + 1.5, poster.h + 1.5),
       THEME.posterEdge, 1.5);

  return { view, poster };
}

function drawSheetGrid(ctx, layout, px, py, scale) {
  // Glue flaps: the strips two neighbouring sheets both print.
  if (layout.overlap > 0.05) {
    ctx.fillStyle = THEME.overlap;
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
  dualDash(ctx, layout.overlap > 0.05 ? THEME.seamLight : THEME.guideLight);

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
      ctx.fillStyle = 'rgba(10, 12, 18, 0.78)';
      ctx.beginPath();
      ctx.roundRect(x, y, w + 10, 16, 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.fillText(tile.label, x + 5, y + 3);
    }
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

function drawHandles(ctx, dest) {
  const s = HANDLE_SIZE;
  halo(ctx, () => ctx.strokeRect(dest.x, dest.y, dest.w, dest.h), THEME.handle, 1.5);
  for (const [cx, cy] of corners(dest)) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
    halo(ctx, () => ctx.strokeRect(cx - s / 2, cy - s / 2, s, s), THEME.handle, 1.5);
  }
}

export function corners(dest) {
  return [
    [dest.x, dest.y],
    [dest.x + dest.w, dest.y],
    [dest.x + dest.w, dest.y + dest.h],
    [dest.x, dest.y + dest.h],
  ];
}
