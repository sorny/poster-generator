// Builds the printable PDF: one page per sheet, plus an optional assembly map.

import { PDFDocument, StandardFonts, rgb } from '../vendor/pdf-lib.esm.min.js';
import { mmToPt } from './layout.js';
import { renderTile } from './renderer.js';

const GUIDE = rgb(0.62, 0.62, 0.66);
const SEAM = rgb(0.35, 0.55, 0.85);
const INK = rgb(0.45, 0.45, 0.5);

export async function buildPosterPdf(opts, onProgress = () => {}) {
  const { source, placement, layout, dpi, format, quality, marks, labels, assemblyMap, transparent } = opts;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  pdf.setTitle(`Poster ${layout.cols}x${layout.rows} - ${source.name}`);
  pdf.setProducer('Poster Generator (offline)');
  pdf.setCreator('Poster Generator');

  if (assemblyMap) drawAssemblyMap(pdf, font, layout, source);

  const pageW = mmToPt(layout.pageW);
  const pageH = mmToPt(layout.pageH);
  const total = layout.tiles.length;

  for (const tile of layout.tiles) {
    onProgress(tile.index / total, `Rendering sheet ${tile.label} (${tile.index + 1}/${total})`);
    // Yield so the progress bar actually paints between sheets.
    await new Promise((r) => setTimeout(r, 0));

    const canvas = await renderTile(source, placement, layout, tile, dpi, { transparent });
    const bytes = await canvasBytes(canvas, format, quality);
    const image = format === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    canvas.width = canvas.height = 0; // release the backing store early

    const page = pdf.addPage([pageW, pageH]);
    page.drawImage(image, { x: 0, y: 0, width: pageW, height: pageH });
    if (marks) drawMarks(page, layout, tile);
    if (labels) drawLabel(page, font, layout, tile, source);
  }

  onProgress(1, 'Writing PDF…');
  return pdf.save();
}

/** PDF y axis points up; poster space points down. */
function flip(layout, mm) {
  return mmToPt(layout.pageH - mm);
}

function drawMarks(page, layout, tile) {
  const m = layout.margin;
  const x0 = mmToPt(m);
  const x1 = mmToPt(m + layout.printW);
  const yTop = flip(layout, m);
  const yBot = flip(layout, m + layout.printH);
  const dash = { dashArray: [3, 3], thickness: 0.4, color: GUIDE };

  // Trim box: cut here and the sheets butt together edge to edge.
  page.drawLine({ start: { x: x0, y: yTop }, end: { x: x1, y: yTop }, ...dash });
  page.drawLine({ start: { x: x0, y: yBot }, end: { x: x1, y: yBot }, ...dash });
  page.drawLine({ start: { x: x0, y: yTop }, end: { x: x0, y: yBot }, ...dash });
  page.drawLine({ start: { x: x1, y: yTop }, end: { x: x1, y: yBot }, ...dash });

  // Corner ticks in the margin, so the trim box stays findable after cutting.
  const tick = mmToPt(Math.min(m * 0.7, 5));
  if (tick > 1) {
    for (const [x, dir] of [[x0, -1], [x1, 1]]) {
      for (const y of [yTop, yBot]) {
        page.drawLine({ start: { x, y }, end: { x: x + dir * tick, y }, thickness: 0.4, color: GUIDE });
      }
    }
    for (const [y, dir] of [[yTop, 1], [yBot, -1]]) {
      for (const x of [x0, x1]) {
        page.drawLine({ start: { x, y }, end: { x, y: y + dir * tick }, thickness: 0.4, color: GUIDE });
      }
    }
  }

  // Seam lines: the inner edge of each glue flap shared with a neighbour.
  if (layout.overlap > 0.05) {
    const seam = { dashArray: [6, 3], thickness: 0.6, color: SEAM };
    if (tile.hasRight) {
      const x = mmToPt(m + layout.printW - layout.overlap);
      page.drawLine({ start: { x, y: yTop }, end: { x, y: yBot }, ...seam });
    }
    if (tile.hasLeft) {
      const x = mmToPt(m + layout.overlap);
      page.drawLine({ start: { x, y: yTop }, end: { x, y: yBot }, ...seam });
    }
    if (tile.hasBottom) {
      const y = flip(layout, m + layout.printH - layout.overlap);
      page.drawLine({ start: { x: x0, y }, end: { x: x1, y }, ...seam });
    }
    if (tile.hasTop) {
      const y = flip(layout, m + layout.overlap);
      page.drawLine({ start: { x: x0, y }, end: { x: x1, y }, ...seam });
    }
  }
}

function drawLabel(page, font, layout, tile, source) {
  const size = Math.min(8, Math.max(5, mmToPt(layout.margin) * 0.5));
  const y = flip(layout, layout.margin) + mmToPt(1.2);
  if (y + size > mmToPt(layout.pageH)) return; // no room above the trim box
  const text = `${tile.label}  ·  row ${tile.row + 1}/${layout.rows}  col ${tile.col + 1}/${layout.cols}`;
  page.drawText(text, { x: mmToPt(layout.margin), y, size, font, color: INK });

  const right = `${source.name}`.slice(-48);
  const w = font.widthOfTextAtSize(right, size);
  const rx = mmToPt(layout.margin + layout.printW) - w;
  if (rx > mmToPt(layout.margin) + font.widthOfTextAtSize(text, size) + 12) {
    page.drawText(right, { x: rx, y, size, font, color: INK });
  }
}

/** A one page overview of how the printed sheets tile together. */
function drawAssemblyMap(pdf, font, layout, source) {
  const pageW = mmToPt(layout.pageW);
  const pageH = mmToPt(layout.pageH);
  const page = pdf.addPage([pageW, pageH]);
  const pad = mmToPt(18);
  const headroom = mmToPt(34);

  page.drawText('Assembly map', { x: pad, y: pageH - pad, size: 16, font, color: rgb(0.1, 0.1, 0.12) });
  const lines = [
    `${layout.cols} x ${layout.rows} sheets  ·  ${fmt(layout.posterW)} x ${fmt(layout.posterH)} mm finished`,
    `${layout.overlap > 0.05 ? `${fmt(layout.overlap)} mm glue overlap` : 'no overlap (trim and butt join)'}  ·  ${fmt(layout.margin)} mm printer margin`,
    `Source: ${source.name}`,
  ];
  lines.forEach((line, i) => {
    page.drawText(line, { x: pad, y: pageH - pad - 18 - i * 11, size: 8, font, color: INK });
  });

  const availW = pageW - 2 * pad;
  const availH = pageH - pad - headroom - pad;
  const scale = Math.min(availW / layout.posterW, availH / layout.posterH);
  const gridW = layout.posterW * scale;
  const gridH = layout.posterH * scale;
  const ox = pad + (availW - gridW) / 2;
  const oy = pad + (availH - gridH) / 2;

  page.drawRectangle({
    x: ox, y: oy, width: gridW, height: gridH,
    color: rgb(0.96, 0.97, 0.99), borderColor: rgb(0.2, 0.2, 0.25), borderWidth: 1,
  });

  for (const tile of layout.tiles) {
    const w = layout.printW * scale;
    const h = layout.printH * scale;
    const x = ox + tile.x0 * scale;
    const y = oy + gridH - tile.y0 * scale - h;
    page.drawRectangle({
      x, y, width: w, height: h,
      borderColor: SEAM, borderWidth: 0.5, borderDashArray: [3, 2],
    });
    const size = Math.min(14, Math.max(7, Math.min(w, h) * 0.28));
    const tw = font.widthOfTextAtSize(tile.label, size);
    page.drawText(tile.label, {
      x: x + w / 2 - tw / 2, y: y + h / 2 - size * 0.35,
      size, font, color: rgb(0.25, 0.28, 0.35),
    });
  }

  page.drawText('Sheets are printed in this order, left to right, top to bottom.', {
    x: pad, y: oy - 12, size: 7.5, font, color: INK,
  });
}

const fmt = (n) => (Math.round(n * 10) / 10).toString();

function canvasBytes(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('Could not encode a sheet — try a lower DPI.'));
        blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
      },
      type,
      type === 'image/jpeg' ? quality : undefined,
    );
  });
}
