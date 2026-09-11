// Sheet presets and the millimetre/inch display layer. The invariant under test
// is that switching units changes only what is displayed, never the geometry.

import { join } from 'node:path';
import { main, sleep, waitForFile, loadPdf } from './harness.js';
import { posterImage, upload, setValue, setUnits, text } from './fixtures.js';

export const name = 'units and sheet presets';

export async function body({ page, check, downloads }) {
  const poster = () => page.run(text('posterReadout'));

  check('sheet menu is grouped',
    (await page.run(`return [...document.getElementById('preset').querySelectorAll('optgroup')]
      .map((g) => g.label + ':' + g.children.length).join(' | ');`))
      === 'ISO A series:4 | US sizes:7 | Custom:1');

  await page.run(setValue('preset', 'letter'));
  await sleep(300);
  const metric = await poster();
  check('Letter 2x3 poster in cm', /39\.2 × 77\.8 cm/.test(metric), metric);

  await page.run(setUnits('in'));
  await sleep(400);
  check('same poster shown in inches', /15\.43 × 30\.64 in/.test(await poster()), await poster());
  await page.run(setUnits('mm'));
  await sleep(400);
  check('unit switch is display-only, geometry unchanged', (await poster()) === metric, await poster());

  await page.run(setUnits('in'));
  await sleep(300);
  check('field labels switch to inches',
    (await page.run(`return document.getElementById('artWLabel').textContent
      + '|' + document.getElementById('customWLabel').textContent;`)) === 'Width (in)|Width (in)');

  const usMenu = await page.run(`return [...document.getElementById('preset')
    .querySelectorAll('optgroup')][1].textContent.replace(/\\s+/g, ' ');`);
  check('US presets carry exact inch dimensions',
    /Letter — 8\.5 × 11 in/.test(usMenu) && /Tabloid \/ Ledger — 11 × 17 in/.test(usMenu)
      && /Super B \/ A3\+ — 13 × 19 in/.test(usMenu), usMenu.slice(0, 160));

  // Sliders carry step="any" and are quantised in JS; changing the step
  // attribute would make the browser re-sanitise the value and resize the poster.
  const snapped = await page.run(`
    const m = document.getElementById('margin'); m.value = '6.9'; m.dispatchEvent(new Event('input'));
    return m.value;`);
  check('dragging snaps to a sixteenth of an inch', Math.abs(+snapped - 25.4 * 4 / 16) < 1e-9, `${snapped} mm`);

  await page.run(setValue('margin', '6.35'));
  await sleep(300);
  check('quarter inch margin reads cleanly',
    (await page.run(text('marginVal'))) === '0.25 in', await page.run(text('marginVal')));
  check('Letter poster becomes exactly 16 x 31.5 in', /16 × 31\.5 in/.test(await poster()), await poster());

  await page.run(setValue('preset', 'custom'));
  await page.run(setValue('customW', '13'));
  await page.run(setValue('customH', '19'));
  await sleep(350);
  check('custom 13x19 in sheet accepted', /25 × 55\.5 in/.test(await poster()), await poster());
  await page.run(setUnits('mm'));
  await sleep(400);
  check('round-trip back to mm is exact',
    (await page.run(`return document.getElementById('customW').value + ' x '
      + document.getElementById('customH').value;`)) === '330.2 x 482.6');

  // --- exported Letter pages must be exactly 8.5 x 11 in
  await page.runAsync(upload(posterImage('us.png', 1400, 1000)));
  await sleep(1300);
  await page.run(setUnits('in'));
  await page.run(setValue('preset', 'letter'));
  await page.run(setValue('cols', 2));
  await page.run(setValue('rows', 2));
  await page.run(`const d = document.getElementById('dpi'); d.value = '150'; d.dispatchEvent(new Event('change'));`);
  await sleep(600);
  await page.run(`document.getElementById('export').click();`);
  const file = await waitForFile(downloads, (f) => f.endsWith('.pdf'));
  check('Letter poster exported', file === 'us-poster-2x2.pdf', String(file));

  if (file) {
    const doc = await loadPdf(join(downloads, file));
    const { width, height } = doc.getPage(1).getSize();
    check('sheets are exactly 612 x 792 pt', width === 612 && height === 792, `${width} x ${height} pt`);
    check('4 sheets + assembly map', doc.getPageCount() === 5, String(doc.getPageCount()));
  }

  check('no page errors', page.errors().length === 0,
    page.errors().map((e) => e.text).join(' | ').slice(0, 300));
}

if (process.argv[1]?.endsWith('units.test.js')) main(name, body);
