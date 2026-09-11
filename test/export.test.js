// The export options. Each toggle changes the PDF, so each one is read back out
// of the produced bytes rather than trusted.
//
// These call buildPosterPdf() directly instead of clicking Export. Headless
// Chrome silently drops a second download that carries a filename it already
// wrote, which caps a download-driven suite at one export. The e2e suite covers
// the real click-to-download path once; this suite covers the matrix.

import { main, sleep } from './harness.js';
import { posterImage, upload, setValue } from './fixtures.js';

export const name = 'export options';

const PDF_LIB = '/vendor/pdf-lib.esm.min.js';

/** Build one PDF in the page with explicit options and return its bytes. */
async function build(page, options) {
  const b64 = await page.runAsync(`
    const { computeLayout, fitPlacement } = await import('/js/layout.js');
    const { loadSource } = await import('/js/source.js');
    const { buildPosterPdf } = await import('/js/exporter.js');
    const o = ${JSON.stringify(options)};

    const c = document.createElement('canvas');
    c.width = 1600; c.height = 1000;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 1600, 1000);
    g.addColorStop(0, '#f9d423'); g.addColorStop(1, '#2b2e83');
    x.fillStyle = g; x.fillRect(0, 0, 1600, 1000);
    x.fillStyle = '#fff'; x.font = '800 180px sans-serif'; x.textAlign = 'center';
    x.fillText('ART', 800, 560);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const source = await loadSource(new File([blob], 'art.png', { type: 'image/png' }));

    const layout = computeLayout({ preset: 'a4', orientation: 'portrait',
      cols: o.cols, rows: o.rows, margin: 10, overlap: o.overlap ?? 0,
      customW: 210, customH: 297 });
    const placement = fitPlacement(layout, source, 0, o.fit ?? 'cover');
    const bytes = await buildPosterPdf({
      source, placement, layout,
      dpi: o.dpi ?? 150,
      format: o.format ?? 'image/jpeg',
      quality: o.quality ?? 0.9,
      marks: o.marks ?? false,
      labels: o.labels ?? false,
      assemblyMap: o.assemblyMap ?? false,
      transparent: o.transparent ?? false,
    });
    source.dispose();

    let s = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(s);`);

  const buf = Buffer.from(b64, 'base64');
  const { PDFDocument } = await import(new URL('../vendor/pdf-lib.esm.min.js', import.meta.url).href);
  return { doc: await PDFDocument.load(buf), bytes: buf, text: buf.toString('latin1') };
}

/**
 * Whether a page carries a font resource. pdf-lib deflates the font dictionary
 * into an object stream, so the font name is never visible in the raw bytes.
 */
async function hasFont(doc, index = 0) {
  const { PDFName } = await import(new URL('../vendor/pdf-lib.esm.min.js', import.meta.url).href);
  const fonts = doc.getPage(index).node.Resources()?.lookup(PDFName.of('Font'));
  return !!fonts && fonts.entries().length > 0;
}

export async function body({ page, check }) {
  // --- page count follows the grid, plus the map
  const one = await build(page, { cols: 1, rows: 1 });
  check('a 1x1 poster with no map is a one page PDF', one.doc.getPageCount() === 1,
    String(one.doc.getPageCount()));
  check('the sheet is A4 portrait in points',
    JSON.stringify(one.doc.getPage(0).getSize()) === JSON.stringify({ width: 595.275591, height: 841.889764 }),
    JSON.stringify(one.doc.getPage(0).getSize()));

  const mapped = await build(page, { cols: 1, rows: 1, assemblyMap: true });
  check('the assembly map adds exactly one page', mapped.doc.getPageCount() === 2,
    String(mapped.doc.getPageCount()));
  check('the map page is the same size as a sheet',
    JSON.stringify(mapped.doc.getPage(0).getSize()) === JSON.stringify(mapped.doc.getPage(1).getSize()));

  const grid = await build(page, { cols: 3, rows: 2, assemblyMap: true });
  check('a 3 by 2 poster exports 6 sheets and a map', grid.doc.getPageCount() === 7,
    String(grid.doc.getPageCount()));
  const big = await build(page, { cols: 4, rows: 3 });
  check('a 4 by 3 poster exports 12 sheets', big.doc.getPageCount() === 12,
    String(big.doc.getPageCount()));

  // --- guides and labels are vector content, so they leave traces in the file
  const bare = await build(page, { cols: 2, rows: 2 });
  const guided = await build(page, { cols: 2, rows: 2, marks: true });
  const labelled = await build(page, { cols: 2, rows: 2, marks: true, labels: true });
  check('cut guides make the file larger', guided.bytes.length > bare.bytes.length,
    `${bare.bytes.length} -> ${guided.bytes.length} bytes`);
  const labelledFont = await hasFont(labelled.doc);
  const bareFont = await hasFont(bare.doc);
  check('sheet labels put a font on the page, a bare export does not',
    labelledFont && !bareFont, `labelled ${labelledFont}, bare ${bareFont}`);
  check('labels add to the guides', labelled.bytes.length > guided.bytes.length,
    `${guided.bytes.length} -> ${labelled.bytes.length} bytes`);
  check('no toggle changes the page count',
    bare.doc.getPageCount() === 4 && guided.doc.getPageCount() === 4 && labelled.doc.getPageCount() === 4);

  // --- encodings
  const jpeg = await build(page, { cols: 1, rows: 1, format: 'image/jpeg', quality: 0.9 });
  const png = await build(page, { cols: 1, rows: 1, format: 'image/png' });
  check('JPEG output embeds a DCT image', jpeg.text.includes('DCTDecode'));
  check('PNG output embeds a Flate image and no DCT one',
    png.text.includes('FlateDecode') && !png.text.includes('DCTDecode'));
  check('the lossless page is larger than the JPEG one', png.bytes.length > jpeg.bytes.length,
    `${jpeg.bytes.length} -> ${png.bytes.length} bytes`);

  const low = await build(page, { cols: 1, rows: 1, quality: 0.4 });
  const high = await build(page, { cols: 1, rows: 1, quality: 1 });
  check('higher JPEG quality makes a larger file', high.bytes.length > low.bytes.length,
    `${low.bytes.length} -> ${high.bytes.length} bytes`);

  // --- resolution
  const at150 = await build(page, { cols: 1, rows: 1, dpi: 150 });
  const at300 = await build(page, { cols: 1, rows: 1, dpi: 300 });
  check('300 dpi carries more data than 150 dpi', at300.bytes.length > at150.bytes.length * 1.5,
    `${at150.bytes.length} -> ${at300.bytes.length} bytes`);
  check('resolution never changes the page size',
    JSON.stringify(at150.doc.getPage(0).getSize()) === JSON.stringify(at300.doc.getPage(0).getSize()));

  // --- document metadata
  check('the PDF carries a title naming the grid',
    /Poster 3x2/.test(grid.doc.getTitle() ?? ''), String(grid.doc.getTitle()));
  // pdf-lib overwrites Producer with its own name on save, so Creator carries this.
  check('the creator names this app', /Poster Generator/.test(grid.doc.getCreator() ?? ''),
    String(grid.doc.getCreator()));

  // --- the panel rules that decide which options are reachable
  await page.runAsync(upload(posterImage('panel.png', 1600, 1000)));
  await sleep(1400);
  await page.run(`const f = document.getElementById('format'); f.value = 'image/png'; f.dispatchEvent(new Event('change'));`);
  await sleep(150);
  check('transparency is offered only for PNG',
    (await page.run(`return document.getElementById('transparentField').hidden;`)) === false);
  check('the JPEG quality slider hides for PNG',
    (await page.run(`return document.getElementById('qualityField').hidden;`)) === true);
  await page.run(`const f = document.getElementById('format'); f.value = 'image/jpeg'; f.dispatchEvent(new Event('change'));`);
  await sleep(150);
  check('the quality slider returns for JPEG',
    (await page.run(`return document.getElementById('qualityField').hidden;`)) === false);
  check('transparency hides again for JPEG',
    (await page.run(`return document.getElementById('transparentField').hidden;`)) === true);

  // --- the readout states the raster size of one sheet
  for (const [dpi, expected] of [['150', '1240 × 1754'], ['300', '2480 × 3508'], ['600', '4961 × 7016']]) {
    await page.run(`const d = document.getElementById('dpi'); d.value = '${dpi}'; d.dispatchEvent(new Event('change'));`);
    await sleep(150);
    const text = await page.run(`return document.getElementById('outputReadout').textContent;`);
    check(`A4 at ${dpi} dpi rasterises to ${expected} px`, text.includes(expected), text.slice(0, 60));
  }
  // The warning is about canvas memory, so it keys on megapixels, not on dpi.
  // A4 at 600 dpi is 34.8 MP and stays quiet; a large sheet at 600 dpi does not.
  check('A4 at 600 dpi stays under the warning threshold',
    !/lower the dpi/i.test(await page.run(`return document.getElementById('outputReadout').textContent;`)));
  await page.run(setValue('preset', 'a2'));
  await sleep(200);
  const a2 = await page.run(`return document.getElementById('outputReadout').textContent;`);
  check('a large sheet at 600 dpi warns about memory', /lower the dpi/i.test(a2), a2.slice(0, 80));
  await page.run(setValue('preset', 'a4'));
  await sleep(200);

  // --- blank sheets are named before the user prints them
  await page.run(`const d = document.getElementById('dpi'); d.value = '150'; d.dispatchEvent(new Event('change'));`);
  await page.run(setValue('cols', 3));
  await page.run(setValue('rows', 2));
  await sleep(300);
  await page.run(`document.getElementById('center').click();`);
  await page.run(setValue('scale', '25'));
  await sleep(300);
  const blank = await page.run(`return document.getElementById('outputReadout').textContent;`);
  check('small artwork names the sheets that print blank', /sheets? print blank/.test(blank),
    blank.replace(/\s+/g, ' ').slice(-60));
  await page.run(setValue('scale', '100'));
  await sleep(300);
  check('a full size artwork reports no blank sheets',
    !/print blank/.test(await page.run(`return document.getElementById('outputReadout').textContent;`)));

  check('no page errors', page.errors().length === 0,
    page.errors().map((e) => e.text).join(' | ').slice(0, 300));
}

if (process.argv[1]?.endsWith('export.test.js')) main(name, body);
