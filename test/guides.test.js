// Guides are drawn over artwork of unknown color. A single translucent color
// cannot stay visible on both a white PDF page and a dark photo, so each guide
// is a dark pass plus a light pass. This measures that it actually works.

import { join } from 'node:path';
import { main, sleep } from './harness.js';
import { whiteDocumentPdf, upload, setValue, setOrientation } from './fixtures.js';

export const name = 'guide contrast';

const MIN_CONTRAST = 60;   // luminance delta a guide must reach against its background

export async function body({ page, check, artifacts }) {
  const measured = await page.runAsync(`
    const { computeLayout } = await import('/js/layout.js');
    const { drawPreview, computeView } = await import('/js/renderer.js');
    const layout = computeLayout({ preset: 'a4', orientation: 'portrait', cols: 3, rows: 2,
                                   margin: 10, overlap: 0, customW: 210, customH: 297 });
    const out = {};

    for (const [label, color] of [['white','#ffffff'], ['black','#000000'], ['mid','#7f7f7f']]) {
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

      // Artwork overhangs the poster so guides sit entirely on top of it.
      drawPreview(cv, { source, layout, showGrid: true, placement: {
        cx: layout.posterW / 2, cy: layout.posterH / 2,
        w: layout.posterW * 1.2, h: layout.posterH * 1.2, rot: 0 } });

      const view = computeView(900, 700, layout);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const ctx = cv.getContext('2d');
      const gx = view.ox + layout.advX * view.scale;          // first vertical sheet boundary
      const gy = view.oy + layout.posterH * view.scale * 0.6;
      const strip = ctx.getImageData(Math.round((gx - 3) * dpr), Math.round(gy * dpr),
                                     Math.round(7 * dpr), Math.round(40 * dpr));
      const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
      let min = 255, max = 0;
      for (let i = 0; i < strip.data.length; i += 4) {
        const l = lum(strip.data[i], strip.data[i + 1], strip.data[i + 2]);
        min = Math.min(min, l); max = Math.max(max, l);
      }
      const bgPixel = ctx.getImageData(Math.round((gx + 40) * dpr), Math.round(gy * dpr), 1, 1).data;
      const bg = lum(bgPixel[0], bgPixel[1], bgPixel[2]);
      out[label] = { bg: Math.round(bg), min: Math.round(min), max: Math.round(max),
                     contrast: Math.round(Math.max(Math.abs(max - bg), Math.abs(bg - min))) };
      cv.remove();
    }
    return out;
  `);

  for (const bg of ['white', 'black', 'mid']) {
    const m = measured[bg];
    check(`grid visible on ${bg} artwork`, m.contrast >= MIN_CONTRAST,
      `bg ${m.bg}, line ${m.min}-${m.max}, contrast ${m.contrast}`);
  }

  // The original bug report: a PDF whose page is white.
  await page.runAsync(upload(whiteDocumentPdf()));
  await sleep(2500);
  await page.run(setValue('cols', 3));
  await page.run(setValue('rows', 2));
  await page.run(setValue('overlap', 12));
  await page.run(setOrientation('landscape'));
  await page.run(`document.getElementById('fill').click();`);
  await sleep(700);
  await page.screenshot(join(artifacts, 'guides-on-white.png'));
  check('white PDF renders without errors', page.errors().length === 0,
    page.errors().map((e) => e.text).join(' | ').slice(0, 300));
}

if (process.argv[1]?.endsWith('guides.test.js')) main(name, body);
