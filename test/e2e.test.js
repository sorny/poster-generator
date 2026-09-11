// Walks the whole app the way a person does: load artwork, change the poster,
// place the image, export, then read the exported PDF back.

import { join } from 'node:path';
import { main, sleep, waitForFile, loadPdf } from './harness.js';
import { posterImage, multiPagePdf, upload, setValue, setOrientation, text } from './fixtures.js';

export const name = 'end to end';

export async function body({ page, check, downloads }) {
  check('app boots and renders readouts',
    await page.run(`return !!document.getElementById('preview').getContext('2d')
      && document.getElementById('posterReadout').textContent.length > 0;`));
  check('no console errors on boot', page.errors().length === 0,
    page.errors().map((e) => e.text).join(' | ').slice(0, 300));

  const poster = () => page.run(text('posterReadout'));
  check('default 2x3 A4 poster', /38 × 83\.1 cm/.test(await poster()), await poster());

  // --- bitmap artwork
  await page.runAsync(upload(posterImage()));
  await sleep(1200);
  check('image loads', (await page.run(text('filename'))) === 'artwork.png');
  const art = await page.run(text('artReadout'));
  check('artwork fits the poster on load', /38 × 23\.8 cm/.test(art), art);
  check('effective dpi reported', /dpi effective/.test(art), art);

  // --- dragging the artwork on the canvas
  for (const [type, x, y, buttons] of [
    ['mousePressed', 900, 450, 1], ['mouseMoved', 960, 520, 1], ['mouseReleased', 960, 520, 0],
  ]) {
    await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, buttons });
  }
  await sleep(300);
  check('drag interaction runs clean', page.errors().length === 0,
    page.errors().map((e) => e.text).join(' | ').slice(0, 300));

  await page.run(`document.getElementById('rotR').click(); document.getElementById('fill').click();`);
  await sleep(200);
  check('rotate 90 then fill', /rotated 90/.test(await page.run(text('artReadout'))),
    await page.run(text('artReadout')));

  // --- relayout
  await page.run(`document.getElementById('rotL').click();`);
  await page.run(setValue('cols', 3));
  await page.run(setValue('rows', 2));
  await page.run(setValue('overlap', 12));
  await page.run(setOrientation('landscape'));
  await sleep(300);
  check('layout recomputes for landscape + overlap',
    /80\.7 × 36\.8 cm/.test(await poster()), await poster());

  // --- multi-page PDF artwork
  await page.runAsync(upload(multiPagePdf()));
  await sleep(2500);
  check('PDF artwork loads', (await page.run(text('filename'))) === 'booklet.pdf');
  check('page selector lists 3 pages and shows',
    (await page.run(`return document.getElementById('pdfpage').options.length
      + '|' + document.getElementById('pagerow').hidden;`)) === '3|false');
  check('PDF reported as vector', /vector/.test(await page.run(text('filenote'))));

  await page.run(`const s = document.getElementById('pdfpage'); s.value = '3'; s.dispatchEvent(new Event('change'));`);
  await sleep(900);
  check('switching PDF page works', (await page.run(`return document.getElementById('pdfpage').value;`)) === '3');

  // Regression: layout rules once overrode the [hidden] attribute.
  check('hidden elements really are hidden',
    (await page.run(`return getComputedStyle(document.getElementById('customsize')).display
      + '|' + getComputedStyle(document.getElementById('progress')).display;`)) === 'none|none');

  // --- export
  await page.run(`const d = document.getElementById('dpi'); d.value = '150'; d.dispatchEvent(new Event('change'));`);
  await page.run(`document.getElementById('export').click();`);
  const file = await waitForFile(downloads, (f) => f.endsWith('.pdf'));
  check('PDF downloaded', file === 'booklet-poster-3x2.pdf', String(file));

  if (file) {
    const doc = await loadPdf(join(downloads, file));
    check('7 pages: 6 sheets + assembly map', doc.getPageCount() === 7, String(doc.getPageCount()));
    const { width, height } = doc.getPage(1).getSize();
    check('sheets are A4 landscape', Math.abs(width - 841.89) < 0.5 && Math.abs(height - 595.28) < 0.5,
      `${width.toFixed(1)} x ${height.toFixed(1)} pt`);
  }

  check('no errors during the whole run', page.errors().length === 0,
    page.errors().map((e) => e.text).join(' | ').slice(0, 400));
}

if (process.argv[1]?.endsWith('e2e.test.js')) main(name, body);
