// Sizing the artwork: the corner and edge handles, the ratio lock, and the
// absence of wheel zoom. The lock is the invariant — with it on, the box can
// never leave the artwork's own ratio, whatever the user drags or types.
//
// The app keeps its state private. After a click on Center the placement is
// fully determined: the center is the middle of the poster, and the width and
// the height are in the panel. That is enough to compute a handle position.

import { main, sleep } from './harness.js';
import { posterImage, upload, setValue } from './fixtures.js';

export const name = 'placement and aspect lock';

const fields = (page) => page.run(`
  return document.getElementById('artW').value + '|' + document.getElementById('artH').value;`);

const sizes = async (page) => (await fields(page)).split('|').map(Number);
const ratio = async (page) => { const [w, h] = await sizes(page); return w / h; };

const setLock = (page, on) => page.run(`
  const c = document.getElementById('lockAspect');
  c.checked = ${on};
  c.dispatchEvent(new Event('change'));`);

/** Screen position of one resize handle, recomputed the way app.js does. */
const handleAt = (page, id, free) => page.runAsync(`
  const { computeLayout } = await import('/js/layout.js');
  const { computeView, handlePoints } = await import('/js/renderer.js');
  const g = (id) => document.getElementById(id);
  const layout = computeLayout({
    preset: g('preset').value,
    orientation: g('orientation').querySelector('.on').dataset.value,
    cols: +g('cols').value, rows: +g('rows').value,
    margin: +g('margin').value, overlap: +g('overlap').value,
    customW: +g('customW').value, customH: +g('customH').value });
  const k = g('artWLabel').textContent.includes('in') ? 25.4 : 10;
  const w = parseFloat(g('artW').value) * k;
  const h = parseFloat(g('artH').value) * k;
  const canvas = g('preview');
  const view = computeView(canvas.clientWidth, canvas.clientHeight, layout);
  const dest = {
    x: view.ox + (layout.posterW / 2 - w / 2) * view.scale,
    y: view.oy + (layout.posterH / 2 - h / 2) * view.scale,
    w: w * view.scale, h: h * view.scale };
  const point = handlePoints(dest, ${free}).find((p) => p.id === '${id}');
  const box = canvas.getBoundingClientRect();
  return point ? { x: box.left + point.x, y: box.top + point.y, scale: view.scale } : null;`);

async function drag(page, from, dx, dy) {
  for (const [type, x, y, buttons] of [
    ['mousePressed', from.x, from.y, 1],
    ['mouseMoved', from.x + dx, from.y + dy, 1],
    ['mouseReleased', from.x + dx, from.y + dy, 0],
  ]) {
    await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, buttons });
  }
  await sleep(200);
}

export async function body({ page, check }) {
  await page.runAsync(upload(posterImage('art.png', 1600, 1000)));
  await sleep(1400);
  await page.run(`document.getElementById('center').click();`);
  await sleep(200);

  check('artwork starts at its own ratio (1.6)', Math.abs(await ratio(page) - 1.6) < 0.01,
    await fields(page));

  // --- locked: the two fields move together
  await page.run(setValue('artW', '20'));
  await sleep(250);
  check('locked: a width change moves the height too', Math.abs(await ratio(page) - 1.6) < 0.01,
    await fields(page));

  await page.run(setValue('artH', '10'));
  await sleep(250);
  check('locked: a height change moves the width too', Math.abs(await ratio(page) - 1.6) < 0.01,
    await fields(page));

  // --- locked: a corner drag keeps the ratio
  await page.run(`document.getElementById('center').click();`);
  await sleep(200);
  const corner = await handleAt(page, 'se', false);
  await drag(page, corner, 60, -10);          // pull mostly sideways
  check('locked: a corner drag keeps the ratio', Math.abs(await ratio(page) - 1.6) < 0.01,
    await fields(page));

  // --- locked: there are no edge handles to grab
  check('locked: no edge handle exists', (await handleAt(page, 'e', false)) === null);

  // --- free: the fields become independent
  await setLock(page, false);
  await sleep(200);
  const [, heightBefore] = await sizes(page);
  await page.run(setValue('artW', '30'));
  await sleep(250);
  let [w, h] = await sizes(page);
  check('free: the width changes alone',
    Math.abs(w - 30) < 0.2 && Math.abs(h - heightBefore) < 0.2, `height ${heightBefore} -> ${h}, width ${w}`);

  await page.run(setValue('artH', '25'));
  await sleep(250);
  [w, h] = await sizes(page);
  check('free: the height changes alone', Math.abs(w - 30) < 0.2 && Math.abs(h - 25) < 0.2, `${w} x ${h}`);

  check('free: the panel reports the stretch',
    /Stretched/.test(await page.run(`return document.getElementById('artReadout').textContent;`)),
    (await page.run(`return document.getElementById('artReadout').textContent;`)).replace(/\s+/g, ' ').slice(0, 80));

  // --- free: an edge handle moves one dimension and leaves the other one alone
  await page.run(`document.getElementById('center').click();`);
  await sleep(200);
  const [beforeW, beforeH] = await sizes(page);
  const east = await handleAt(page, 'e', true);
  check('free: the east edge handle exists', east !== null);
  if (east) {
    await drag(page, east, 70, 0);
    const [afterW, afterH] = await sizes(page);
    check('free: the east handle changes only the width',
      afterW > beforeW + 1 && Math.abs(afterH - beforeH) < 0.2,
      `${beforeW} x ${beforeH} -> ${afterW} x ${afterH}`);

    // The east drag anchored the west edge, so the box is no longer centred and
    // handleAt would compute the wrong point. Re-centre first; that keeps w and h.
    await page.run(`document.getElementById('center').click();`);
    await sleep(200);
    const [midW, midH] = await sizes(page);
    const south = await handleAt(page, 's', true);
    await drag(page, south, 0, 50);
    const [endW, endH] = await sizes(page);
    check('free: the south handle changes only the height',
      endH > midH + 1 && Math.abs(endW - midW) < 0.2,
      `${midW} x ${midH} -> ${endW} x ${endH}`);
  }

  // --- locking again removes the stretch
  await setLock(page, true);
  await sleep(250);
  check('locking again restores the artwork ratio', Math.abs(await ratio(page) - 1.6) < 0.01,
    await fields(page));
  check('locking again clears the stretch warning',
    !/Stretched/.test(await page.run(`return document.getElementById('artReadout').textContent;`)));

  // --- the wheel must not resize anything any more
  const sizeBefore = await fields(page);
  const centre = JSON.parse(await page.run(`
    const b = document.getElementById('preview').getBoundingClientRect();
    return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2 });`));
  for (const deltaY of [-240, -240, 240]) {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: centre.x, y: centre.y, deltaX: 0, deltaY });
  }
  await sleep(400);
  check('the wheel no longer resizes the artwork', (await fields(page)) === sizeBefore,
    `${sizeBefore} -> ${await fields(page)}`);
  check('the hint no longer names the wheel',
    !/scroll/i.test(await page.run(`return document.getElementById('artReadout').textContent;`)));

  // --- handle sets
  const counts = await page.runAsync(`
    const { handlePoints } = await import('/js/renderer.js');
    const dest = { x: 0, y: 0, w: 100, h: 80 };
    return handlePoints(dest, false).length + '|' + handlePoints(dest, true).length
         + '|' + handlePoints(dest, true).map((p) => p.id).join(',');`);
  const [lockedCount, freeCount, ids] = counts.split('|');
  check('locked has 4 handles, free has 8', lockedCount === '4' && freeCount === '8', counts.slice(0, 40));
  check('free adds the four edge midpoints',
    ['n', 'e', 's', 'w'].every((id) => ids.split(',').includes(id)), ids);

  check('no page errors', page.errors().length === 0,
    page.errors().map((e) => e.text).join(' | ').slice(0, 300));
}

if (process.argv[1]?.endsWith('placement.test.js')) main(name, body);
