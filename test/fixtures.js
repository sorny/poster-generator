// Artwork built inside the page, so the suites need no binary fixtures on disk.
// Each helper returns a snippet of browser JS that hands a File to the app.

/** A gradient poster image with headline text. */
export const posterImage = (name = 'artwork.png', w = 1600, h = 1000) => `
  const c = document.createElement('canvas'); c.width = ${w}; c.height = ${h};
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, ${w}, ${h});
  g.addColorStop(0, '#f9d423'); g.addColorStop(0.45, '#ff4e50'); g.addColorStop(1, '#2b2e83');
  x.fillStyle = g; x.fillRect(0, 0, ${w}, ${h});
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '800 ${Math.round(w / 9)}px sans-serif'; x.fillText('POSTER', ${w / 2}, ${h * 0.45});
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  return new File([blob], '${name}', { type: 'image/png' });`;

/** A multi-page vector PDF, one flat colour per page. */
export const multiPagePdf = (name = 'booklet.pdf') => `
  const { PDFDocument, rgb } = await import('/vendor/pdf-lib.esm.min.js');
  const doc = await PDFDocument.create();
  for (const c of [rgb(0.9, 0.2, 0.2), rgb(0.2, 0.7, 0.3), rgb(0.2, 0.4, 0.9)]) {
    const p = doc.addPage([595, 842]);
    p.drawRectangle({ x: 40, y: 40, width: 515, height: 762, color: c });
  }
  const bytes = await doc.save();
  return new File([bytes], '${name}', { type: 'application/pdf' });`;

/** A white document page — the case where naive guide colours disappear. */
export const whiteDocumentPdf = (name = 'report.pdf') => `
  const { PDFDocument, rgb, StandardFonts } = await import('/vendor/pdf-lib.esm.min.js');
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([842, 595]);
  p.drawText('QUARTERLY REPORT', { x: 60, y: 480, size: 42, font: f, color: rgb(0.1, 0.1, 0.12) });
  p.drawRectangle({ x: 60, y: 120, width: 300, height: 280, color: rgb(0.92, 0.94, 0.98) });
  for (let i = 0; i < 6; i++) {
    p.drawRectangle({ x: 400 + i * 62, y: 120, width: 40, height: 40 + i * 42, color: rgb(0.25, 0.5, 0.9) });
  }
  const bytes = await doc.save();
  return new File([bytes], '${name}', { type: 'application/pdf' });`;

/** Feed a fixture through the real file input, exactly as a user drop would. */
export const upload = (fixture) => `
  const file = await (async () => { ${fixture} })();
  const dt = new DataTransfer();
  dt.items.add(file);
  const input = document.getElementById('file');
  input.files = dt.files;
  input.dispatchEvent(new Event('change'));`;

/** Shorthands for driving the control panel. */
export const setValue = (id, value) =>
  `const e = document.getElementById('${id}'); e.value = '${value}'; e.dispatchEvent(new Event('input'));`;
export const setUnits = (unit) =>
  `[...document.getElementById('units').children].find((b) => b.dataset.value === '${unit}').click();`;
export const setOrientation = (o) =>
  `[...document.getElementById('orientation').children].find((b) => b.dataset.value === '${o}').click();`;
export const text = (id) =>
  `return document.getElementById('${id}').textContent.replace(/\\s+/g, ' ').trim();`;
