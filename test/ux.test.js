// Guards for the findings of the interface review. Each check here failed before
// the fix, so each one is a regression test rather than a restatement.

import { main, sleep } from './harness.js';
import { posterImage, upload, setValue } from './fixtures.js';

export const name = 'interface fixes';

const rect = (page, sel) => page.run(`
  const e = document.querySelector('${sel}');
  if (!e) return null;
  const b = e.getBoundingClientRect();
  return JSON.stringify({ w: +b.width.toFixed(0), h: +b.height.toFixed(0), top: +b.top.toFixed(0) });`);

export async function body({ page, check }) {
  // --- B1: the stage used to compute to 0px tall under 860px
  for (const [w, h] of [[700, 900], [420, 800]]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await sleep(450);
    const box = JSON.parse(await rect(page, '.canvaswrap'));
    const buffer = await page.run(`
      const c = document.getElementById('preview');
      return c.width + 'x' + c.height;`);
    check(`canvas has height at ${w}px wide`, box.h > 200, `${box.w}x${box.h}, buffer ${buffer}`);
  }
  await page.send('Emulation.clearDeviceMetricsOverride');
  await sleep(400);

  // --- H4: buttons cleared the user-agent outline and were missing from the rule.
  // :focus-visible only matches keyboard focus, so this walks with real Tab keys
  // rather than calling focus(), which would never match on a button.
  await page.run(`document.body.focus(); document.activeElement.blur();`);
  const rings = [];
  for (let i = 0; i < 30; i++) {
    await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    const stop = await page.run(`
      const e = document.activeElement;
      if (!e || e === document.body) return null;
      const cs = getComputedStyle(e);
      return JSON.stringify({
        tag: e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className ? '.' + String(e.className).split(' ')[0] : ''),
        ring: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 });`);
    if (stop) rings.push(JSON.parse(stop));
  }
  const buttons = rings.filter((r) => r.tag.startsWith('button'));
  const ringless = rings.filter((r) => !r.ring).map((r) => r.tag);
  check('every control reached by Tab shows a focus ring',
    rings.length > 10 && ringless.length === 0,
    `${rings.length} stops, ${buttons.length} buttons, missing: ${ringless.join(', ') || 'none'}`);

  // --- H2: the primary action was at y=1272 in a 757px viewport
  const exportBox = JSON.parse(await rect(page, '#export'));
  const viewport = await page.run(`return window.innerHeight;`);
  check('the export control is on screen without scrolling',
    exportBox.top > 0 && exportBox.top < viewport, `top ${exportBox.top}, viewport ${viewport}`);
  check('a disabled export says why',
    /add artwork/i.test(await page.run(`return document.getElementById('export').textContent;`)),
    await page.run(`return document.getElementById('export').textContent;`));

  // --- H1: the stage is a drop target and says so
  check('the empty stage invites a drop',
    await page.run(`
      const e = document.getElementById('emptystate');
      return !e.hidden && /drop a pdf or image/i.test(e.textContent);`));
  check('a drag lights up the stage, not only the sidebar',
    await page.run(`
      document.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true }));
      const lit = document.getElementById('canvaswrap').classList.contains('over');
      document.dispatchEvent(new DragEvent('dragleave', { bubbles: true }));
      return lit;`));

  // --- M6: errors are announced and can be dismissed
  await page.runAsync(`
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([1, 2, 3])], 'notes.txt', { type: 'text/plain' }));
    const i = document.getElementById('file');
    i.files = dt.files;
    i.dispatchEvent(new Event('change'));`);
  await sleep(800);
  const toast = await page.run(`
    const t = document.getElementById('toast');
    return JSON.stringify({ hidden: t.hidden, role: t.getAttribute('role'),
      live: t.getAttribute('aria-live'), text: document.getElementById('toastText').textContent });`);
  const parsed = JSON.parse(toast);
  check('an error is announced to assistive tech',
    parsed.role === 'status' && parsed.live === 'polite', `role=${parsed.role} live=${parsed.live}`);
  check('the error names the accepted formats',
    /PNG, JPEG, WebP, GIF or PDF/.test(parsed.text), parsed.text);
  check('the error can be dismissed',
    await page.run(`
      document.getElementById('toastClose').click();
      return document.getElementById('toast').hidden;`));

  // --- load artwork for the placement checks
  await page.runAsync(upload(posterImage('art.png', 1600, 1000)));
  await sleep(1400);
  check('the empty state clears once artwork loads',
    await page.run(`return document.getElementById('emptystate').hidden;`));
  check('the export control now names the sheet count',
    /\d+ sheets/.test(await page.run(`return document.getElementById('export').textContent;`)),
    await page.run(`return document.getElementById('export').textContent;`));
  check('the canvas describes itself',
    /poster preview\..*cm/i.test(await page.run(`return document.getElementById('preview').getAttribute('aria-label');`)),
    (await page.run(`return document.getElementById('preview').getAttribute('aria-label');`)).slice(0, 70));

  // --- M1: print measurements can be typed, not only dragged
  await page.run(`
    const n = document.getElementById('marginNum');
    n.value = '12'; n.dispatchEvent(new Event('input'));`);
  await sleep(350);
  check('typing a margin moves the slider',
    Math.abs(+(await page.run(`return document.getElementById('margin').value;`)) - 12) < 0.01,
    await page.run(`return document.getElementById('margin').value;`));
  await page.run(`
    const n = document.getElementById('scaleNum');
    n.value = '60'; n.dispatchEvent(new Event('input'));`);
  await sleep(350);
  check('typing a scale resizes the artwork',
    Math.abs(+(await page.run(`return document.getElementById('scale').value;`)) - 60) < 1,
    await page.run(`return document.getElementById('scale').value;`));

  // --- M3: undo
  const width = () => page.run(`return document.getElementById('artW').value;`);
  await page.run(`document.getElementById('fit').click();`);
  await sleep(250);
  const beforeFill = await width();
  await page.run(`document.getElementById('fill').click();`);
  await sleep(250);
  const afterFill = await width();
  check('fill changes the artwork size', beforeFill !== afterFill, `${beforeFill} -> ${afterFill}`);

  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', modifiers: 4, windowsVirtualKeyCode: 90 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', modifiers: 4, windowsVirtualKeyCode: 90 });
  await sleep(350);
  check('undo restores the previous placement', (await width()) === beforeFill,
    `${afterFill} -> ${await width()} (want ${beforeFill})`);

  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Z', code: 'KeyZ', modifiers: 12, windowsVirtualKeyCode: 90 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Z', code: 'KeyZ', modifiers: 12, windowsVirtualKeyCode: 90 });
  await sleep(350);
  check('redo puts it back', (await width()) === afterFill, `${await width()} (want ${afterFill})`);

  // --- H3: progress must not outlive its operation
  await page.run(`
    const d = document.getElementById('dpi'); d.value = '150'; d.dispatchEvent(new Event('change'));`);
  await page.run(setValue('cols', 1));
  await page.run(setValue('rows', 1));
  await sleep(300);
  await page.run(`document.getElementById('export').click();`);
  await sleep(3500);
  const done = await page.run(`return document.getElementById('progressText').textContent;`);
  check('the export confirmation names the file', /Saved .*\.pdf/.test(done), done);
  check('the confirmation is singular for one sheet', !/1 sheets/.test(done), done);
  await page.run(setValue('cols', 2));
  await sleep(400);
  check('changing the poster clears stale export feedback',
    await page.run(`return document.getElementById('progress').hidden;`));

  // The rejected .txt above logs deliberately, so only unexpected errors count.
  const unexpected = page.errors().filter((e) => !/Cannot read notes\.txt/.test(e.text));
  // --- M5: blank sheets are shown where the user causes them, not only in a
  // list three sections away and below the fold.
  await page.run(setValue('cols', 3));
  await page.run(setValue('rows', 2));
  await sleep(300);
  await page.run(`document.getElementById('center').click();`);
  await page.run(setValue('scale', '22'));
  await sleep(400);

  const marked = await page.runAsync(`
    const { computeLayout, placementRect } = await import('/js/layout.js');
    const { computeView, blankTiles } = await import('/js/renderer.js');
    const g = (id) => document.getElementById(id);
    const layout = computeLayout({
      preset: g('preset').value,
      orientation: g('orientation').querySelector('.on').dataset.value,
      cols: +g('cols').value, rows: +g('rows').value,
      margin: +g('margin').value, overlap: +g('overlap').value,
      customW: +g('customW').value, customH: +g('customH').value });
    const k = g('artWLabel').textContent.includes('in') ? 25.4 : 10;
    const placement = { cx: layout.posterW / 2, cy: layout.posterH / 2,
                        w: parseFloat(g('artW').value) * k, h: parseFloat(g('artH').value) * k, rot: 0 };
    const blanks = blankTiles(layout, placement);
    const canvas = g('preview');
    const view = computeView(canvas.clientWidth, canvas.clientHeight, layout);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ctx = canvas.getContext('2d');
    // Sample the middle of a blank sheet and of a covered one.
    const sample = (tile) => {
      const x = view.ox + (tile.x0 + layout.printW / 2) * view.scale;
      const y = view.oy + (tile.y0 + layout.printH / 2) * view.scale;
      const d = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 24, 24).data;
      let min = 255, max = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        min = Math.min(min, l); max = Math.max(max, l);
      }
      return { spread: Math.round(max - min) };
    };
    const blankTile = layout.tiles.find((t) => blanks.includes(t.label));
    const liveTile = layout.tiles.find((t) => !blanks.includes(t.label));
    return JSON.stringify({ blanks, blank: blankTile && sample(blankTile), live: liveTile && sample(liveTile) });`);

  const m = JSON.parse(marked);
  check('small artwork leaves some sheets blank', m.blanks.length > 0 && m.blanks.length < 6,
    m.blanks.join(', '));
  check('blank sheets are hatched on the canvas', m.blank && m.blank.spread > 12,
    `blank spread ${m.blank?.spread}, covered spread ${m.live?.spread}`);

  check('turning off the sheet grid clears the hatching too',
    await page.runAsync(`
      const g = document.getElementById('showGrid');
      g.checked = false; g.dispatchEvent(new Event('change'));
      await new Promise((r) => setTimeout(r, 200));
      const { computeLayout } = await import('/js/layout.js');
      const { computeView } = await import('/js/renderer.js');
      const el = (id) => document.getElementById(id);
      const layout = computeLayout({
        preset: el('preset').value,
        orientation: el('orientation').querySelector('.on').dataset.value,
        cols: +el('cols').value, rows: +el('rows').value,
        margin: +el('margin').value, overlap: +el('overlap').value,
        customW: +el('customW').value, customH: +el('customH').value });
      const canvas = el('preview');
      const view = computeView(canvas.clientWidth, canvas.clientHeight, layout);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const ctx = canvas.getContext('2d');
      const t = layout.tiles[0];
      const x = view.ox + (t.x0 + layout.printW / 2) * view.scale;
      const y = view.oy + (t.y0 + layout.printH / 2) * view.scale;
      const d = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 24, 24).data;
      let min = 255, max = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        min = Math.min(min, l); max = Math.max(max, l);
      }
      g.checked = true; g.dispatchEvent(new Event('change'));
      return max - min < 6;`));

  await page.run(setValue('scale', '100'));
  await sleep(400);

  check('no unexpected page errors', unexpected.length === 0,
    unexpected.map((e) => e.text).join(' | ').slice(0, 300));
}

if (process.argv[1]?.endsWith('ux.test.js')) main(name, body);
