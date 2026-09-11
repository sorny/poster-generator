// Poster geometry. Every dimension in this module is millimeters unless the
// name says otherwise. Conversions to pixels happen only at render time.

export const MM_PER_INCH = 25.4;
export const PT_PER_MM = 72 / MM_PER_INCH;

// Rounded well below any meaningful precision so exact sizes stay exact:
// Letter comes out as 612 pt rather than 612.0000000000001.
export const mmToPt = (mm) => Math.round(mm * PT_PER_MM * 1e6) / 1e6;
export const mmToPx = (mm, dpi) => (mm / MM_PER_INCH) * dpi;

// Portrait dimensions [width, height] in mm. US sizes are the exact inch
// equivalents: Letter is 8.5 x 11 in, Tabloid 11 x 17 in, and so on. Landscape
// is the orientation control, so Ledger is Tabloid rotated rather than a preset.
export const PAGE_PRESETS = {
  a5: { label: 'A5', group: 'ISO A series', size: [148, 210] },
  a4: { label: 'A4', group: 'ISO A series', size: [210, 297] },
  a3: { label: 'A3', group: 'ISO A series', size: [297, 420] },
  a2: { label: 'A2', group: 'ISO A series', size: [420, 594] },
  halfletter: { label: 'Half Letter', group: 'US sizes', size: [139.7, 215.9] },
  executive: { label: 'Executive', group: 'US sizes', size: [184.15, 266.7] },
  letter: { label: 'Letter', group: 'US sizes', size: [215.9, 279.4] },
  legal: { label: 'Legal', group: 'US sizes', size: [215.9, 355.6] },
  tabloid: { label: 'Tabloid / Ledger', group: 'US sizes', size: [279.4, 431.8] },
  superb: { label: 'Super B / A3+', group: 'US sizes', size: [330.2, 482.6] },
  archb: { label: 'Arch B', group: 'US sizes', size: [304.8, 457.2] },
  custom: { label: 'Custom', group: 'Custom', size: [210, 297] },
};

export function pageSize(cfg) {
  const preset = PAGE_PRESETS[cfg.preset] ?? PAGE_PRESETS.a4;
  const [w, h] = cfg.preset === 'custom' ? [cfg.customW, cfg.customH] : preset.size;
  return cfg.orientation === 'landscape' ? { w: Math.max(w, h), h: Math.min(w, h) }
                                         : { w: Math.min(w, h), h: Math.max(w, h) };
}

/**
 * Turn a page setup into a tiling of the poster.
 *
 * Each sheet prints `printW x printH` of artwork inside its unprintable margin.
 * Neighbouring sheets duplicate `overlap` mm of artwork, so the poster advances
 * by `printW - overlap` per column. Cut along the overlap line and glue, or set
 * overlap to 0 and butt the trimmed sheets together.
 */
export function computeLayout(cfg) {
  const { w: pageW, h: pageH } = pageSize(cfg);
  const margin = Math.max(0, Math.min(cfg.margin, Math.min(pageW, pageH) / 2 - 1));
  const printW = pageW - 2 * margin;
  const printH = pageH - 2 * margin;
  const overlap = Math.max(0, Math.min(cfg.overlap, Math.min(printW, printH) - 1));

  const advX = printW - overlap;
  const advY = printH - overlap;
  const cols = Math.max(1, Math.round(cfg.cols));
  const rows = Math.max(1, Math.round(cfg.rows));

  const posterW = cols * advX + overlap;
  const posterH = rows * advY + overlap;

  const tiles = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      tiles.push({
        col, row,
        index: row * cols + col,
        label: `${rowLabel(row)}${col + 1}`,
        x0: col * advX,          // poster coordinate at the tile's left print edge
        y0: row * advY,
        hasLeft: col > 0,
        hasRight: col < cols - 1,
        hasTop: row > 0,
        hasBottom: row < rows - 1,
      });
    }
  }

  return { pageW, pageH, margin, overlap, printW, printH, advX, advY, cols, rows, posterW, posterH, tiles };
}

/** Row names A to Z, then AA to AZ, so a tall poster keeps readable labels. */
export function rowLabel(row) {
  let name = '';
  for (let n = row; n >= 0; n = Math.floor(n / 26) - 1) {
    name = String.fromCharCode(65 + (n % 26)) + name;
  }
  return name;
}

/** Displayed aspect ratio of the artwork, accounting for 90 degree rotation. */
export function placedAspect(source, rot) {
  const a = source.width / source.height;
  return rot % 180 === 0 ? a : 1 / a;
}

/** Axis aligned artwork rectangle in poster space. */
export function placementRect(placement) {
  return {
    x: placement.cx - placement.w / 2,
    y: placement.cy - placement.h / 2,
    w: placement.w,
    h: placement.h,
  };
}

/**
 * Scale the artwork so it fits inside (contain) or covers (cover) the poster.
 * `aspect` defaults to the artwork's own ratio. Pass the ratio of the current
 * box instead when the user has unlocked the ratio, so that a fit does not
 * silently undo a deliberate stretch.
 */
export function fitPlacement(layout, source, rot, mode, aspect = placedAspect(source, rot)) {
  const posterAspect = layout.posterW / layout.posterH;
  const useWidth = mode === 'cover' ? aspect < posterAspect : aspect > posterAspect;
  const w = useWidth ? layout.posterW : layout.posterH * aspect;
  return {
    cx: layout.posterW / 2,
    cy: layout.posterH / 2,
    w,
    h: w / aspect,
    rot,
  };
}
