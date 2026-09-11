// The colour scheme follows the OS via prefers-color-scheme. The panel and the
// preview canvas must both switch, and the guides must keep their contrast in
// either scheme — they sit on artwork whose colour has nothing to do with the theme.

import { join } from 'node:path';
import { main, sleep } from './harness.js';
import { posterImage, upload, setValue } from './fixtures.js';

export const name = 'colour scheme';

const emulate = (page, scheme) => page.send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-color-scheme', value: scheme }],
});

/** Luminance of the panel background and the preview canvas workspace. */
const probe = (page) => page.run(`
  const panel = getComputedStyle(document.querySelector('.panel')).backgroundColor;
  const text = getComputedStyle(document.body).color;
  const scheme = getComputedStyle(document.documentElement).colorScheme;
  const canvas = document.getElementById('preview');
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const px = ctx.getImageData(Math.round(6 * dpr), Math.round(6 * dpr), 1, 1).data;
  const lum = (r, g, b) => Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const parse = (c) => c.match(/\\d+/g).slice(0, 3).map(Number);
  return { scheme, panel: lum(...parse(panel)), text: lum(...parse(text)),
           workspace: lum(px[0], px[1], px[2]) };`);

export async function body({ page, check, artifacts }) {
  await page.runAsync(upload(posterImage('theme.png')));
  await sleep(1300);
  await page.run(setValue('overlap', 10));
  await sleep(300);

  await emulate(page, 'dark');
  await page.run(`document.getElementById('preview').dispatchEvent(new Event('x'));`);
  await sleep(400);
  const dark = await probe(page);
  await page.screenshot(join(artifacts, 'dark.png'));

  await emulate(page, 'light');
  await sleep(500);
  const light = await probe(page);
  await page.screenshot(join(artifacts, 'light.png'));

  check('dark scheme reported to the UA', dark.scheme === 'dark', dark.scheme);
  check('light scheme reported to the UA', light.scheme === 'light', light.scheme);
  check('panel inverts between schemes', dark.panel < 60 && light.panel > 200,
    `dark ${dark.panel}, light ${light.panel}`);
  check('text inverts between schemes', dark.text > 200 && light.text < 60,
    `dark ${dark.text}, light ${light.text}`);
  check('preview canvas follows the scheme', dark.workspace < 60 && light.workspace > 180,
    `dark ${dark.workspace}, light ${light.workspace}`);

  // Guides must stay readable in both schemes, over pale and dark artwork alike.
  for (const scheme of ['light', 'dark']) {
    await emulate(page, scheme);
    await sleep(300);
    const measured = await page.runAsync(`
      const { computeLayout } = await import('/js/layout.js');
      const { drawPreview, computeView, refreshTheme } = await import('/js/renderer.js');
      refreshTheme();
      const layout = computeLayout({ preset: 'a4', orientation: 'portrait', cols: 3, rows: 2,
                                     margin: 10, overlap: 0, customW: 210, customH: 297 });
      const out = {};
      for (const [label, color] of [['white', '#ffffff'], ['black', '#000000']]) {
        const art = document.createElement('canvas');
        art.width = 1200; art.height = 900;
        const ag = art.getContext('2d'); ag.fillStyle = color; ag.fillRect(0, 0, 1200, 900);
        const source = { kind: 'image', name: label, width: 1200, height: 900,
                         preview: await createImageBitmap(art), drawInto() {} };
        const cv = document.createElement('canvas');
        cv.width = 900; cv.height = 700;
        Object.defineProperty(cv, 'clientWidth', { value: 900 });
        Object.defineProperty(cv, 'clientHeight', { value: 700 });
        document.body.append(cv);
        drawPreview(cv, { source, layout, showGrid: true, placement: {
          cx: layout.posterW / 2, cy: layout.posterH / 2,
          w: layout.posterW * 1.2, h: layout.posterH * 1.2, rot: 0 } });
        const view = computeView(900, 700, layout);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const ctx = cv.getContext('2d');
        const gx = view.ox + layout.advX * view.scale;
        const gy = view.oy + layout.posterH * view.scale * 0.6;
        const strip = ctx.getImageData(Math.round((gx - 3) * dpr), Math.round(gy * dpr),
                                       Math.round(7 * dpr), Math.round(40 * dpr));
        const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
        let min = 255, max = 0;
        for (let i = 0; i < strip.data.length; i += 4) {
          const l = lum(strip.data[i], strip.data[i + 1], strip.data[i + 2]);
          min = Math.min(min, l); max = Math.max(max, l);
        }
        const bg = ctx.getImageData(Math.round((gx + 40) * dpr), Math.round(gy * dpr), 1, 1).data;
        const bgLum = lum(bg[0], bg[1], bg[2]);
        out[label] = Math.round(Math.max(Math.abs(max - bgLum), Math.abs(bgLum - min)));
        cv.remove();
      }
      return out;`);
    check(`guides keep contrast in ${scheme} scheme over white artwork`, measured.white >= 60,
      `contrast ${measured.white}`);
    check(`guides keep contrast in ${scheme} scheme over black artwork`, measured.black >= 60,
      `contrast ${measured.black}`);
  }

  check('no page errors', page.errors().length === 0,
    page.errors().map((e) => e.text).join(' | ').slice(0, 300));
}

if (process.argv[1]?.endsWith('theme.test.js')) main(name, body);
