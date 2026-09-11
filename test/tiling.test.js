// The core claim of the app: every sheet carries exactly its own region of the
// artwork. Verified by sampling rendered pixels, not by reading the maths.

import { main } from './harness.js';

export const name = 'tiling accuracy';

export async function body({ page, check }) {
  const r = await page.runAsync(`
    const { computeLayout, fitPlacement } = await import('/js/layout.js');
    const { renderTile } = await import('/js/renderer.js');
    const { loadSource } = await import('/js/source.js');
    const out = {};
    const near = (a, b, tol = 12) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
    const cfg = { preset: 'a4', orientation: 'portrait', cols: 2, rows: 2,
                  margin: 10, overlap: 0, customW: 210, customH: 297 };

    // --- four colour quadrants sized to the poster's exact aspect ratio
    const layout = computeLayout(cfg);
    out.poster = [layout.posterW, layout.posterH];
    const c = document.createElement('canvas');
    c.width = Math.round(layout.posterW * 4); c.height = Math.round(layout.posterH * 4);
    const g = c.getContext('2d');
    for (const [color, qx, qy] of [['#ff0000',0,0], ['#00ff00',1,0], ['#0000ff',0,1], ['#ffff00',1,1]]) {
      g.fillStyle = color;
      g.fillRect(qx * c.width / 2, qy * c.height / 2, c.width / 2, c.height / 2);
    }
    const bmp = await createImageBitmap(c);
    const source = { kind: 'image', name: 'quad', width: bmp.width, height: bmp.height,
                     preview: bmp, drawInto(ctx, w, h) { ctx.drawImage(bmp, 0, 0, w, h); } };
    const placement = fitPlacement(layout, source, 0, 'contain');
    out.placement = [placement.w, placement.h];

    const pick = (canvas, pageW, mmX, mmY) => {
      const s = canvas.width / pageW;
      const d = canvas.getContext('2d').getImageData(Math.round(mmX * s), Math.round(mmY * s), 1, 1).data;
      return [d[0], d[1], d[2]];
    };

    out.tiles = [];
    for (const tile of layout.tiles) {
      const canvas = await renderTile(source, placement, layout, tile, 72);
      out.tiles.push({
        label: tile.label,
        mid: pick(canvas, layout.pageW, layout.margin + layout.printW / 2, layout.margin + layout.printH / 2),
        marginWhite: near(pick(canvas, layout.pageW, 2, 2), [255, 255, 255], 2),
      });
    }
    out.quadrantsCorrect = near(out.tiles[0].mid, [255,0,0]) && near(out.tiles[1].mid, [0,255,0])
                        && near(out.tiles[2].mid, [0,0,255]) && near(out.tiles[3].mid, [255,255,0]);
    out.marginsWhite = out.tiles.every((t) => t.marginWhite);

    // --- a glue overlap must print the same artwork on both neighbours
    const oLayout = computeLayout({ ...cfg, overlap: 20 });
    const grad = document.createElement('canvas');
    grad.width = 1200; grad.height = Math.round(1200 * oLayout.posterH / oLayout.posterW);
    const gg = grad.getContext('2d');
    const lg = gg.createLinearGradient(0, 0, grad.width, grad.height);
    lg.addColorStop(0, '#000080'); lg.addColorStop(0.5, '#ff8000'); lg.addColorStop(1, '#00ff80');
    gg.fillStyle = lg; gg.fillRect(0, 0, grad.width, grad.height);
    const gbmp = await createImageBitmap(grad);
    const gsource = { kind: 'image', name: 'grad', width: gbmp.width, height: gbmp.height,
                      preview: gbmp, drawInto(ctx, w, h) { ctx.drawImage(gbmp, 0, 0, w, h); } };
    const gp = fitPlacement(oLayout, gsource, 0, 'contain');
    const a1 = await renderTile(gsource, gp, oLayout, oLayout.tiles[0], 150);
    const a2 = await renderTile(gsource, gp, oLayout, oLayout.tiles[1], 150);
    const posterX = 180, posterY = 100;   // a point inside the shared strip
    out.overlapA1 = pick(a1, oLayout.pageW, oLayout.margin + posterX - oLayout.tiles[0].x0, oLayout.margin + posterY);
    out.overlapA2 = pick(a2, oLayout.pageW, oLayout.margin + posterX - oLayout.tiles[1].x0, oLayout.margin + posterY);
    out.overlapMatches = near(out.overlapA1, out.overlapA2, 4);

    // --- PDF artwork goes through pdf.js vector rendering, once per sheet
    const { PDFDocument, rgb } = await import('/vendor/pdf-lib.esm.min.js');
    const doc = await PDFDocument.create();
    const pg = doc.addPage([400, 400]);
    pg.drawRectangle({ x: 0,   y: 200, width: 200, height: 200, color: rgb(1, 0, 0) });
    pg.drawRectangle({ x: 200, y: 200, width: 200, height: 200, color: rgb(0, 1, 0) });
    pg.drawRectangle({ x: 0,   y: 0,   width: 200, height: 200, color: rgb(0, 0, 1) });
    pg.drawRectangle({ x: 200, y: 0,   width: 200, height: 200, color: rgb(1, 1, 0) });
    const psource = await loadSource(new File([await doc.save()], 'vector.pdf', { type: 'application/pdf' }));
    out.pdf = { w: psource.width, h: psource.height, pages: psource.pageCount, kind: psource.kind };

    const sq = computeLayout(cfg);
    const pp = { cx: sq.posterW / 2, cy: sq.posterH / 2, w: sq.posterW, h: sq.posterW, rot: 0 };
    const top = pp.cy - pp.w / 2;
    const t0 = await renderTile(psource, pp, sq, sq.tiles[0], 100);
    const t1 = await renderTile(psource, pp, sq, sq.tiles[1], 100);
    out.pdfTopLeft  = pick(t0, sq.pageW, sq.margin + 40, sq.margin + top + 40);
    out.pdfTopRight = pick(t1, sq.pageW, sq.margin + sq.posterW - 40 - sq.tiles[1].x0, sq.margin + top + 40);
    out.pdfVectorOk = near(out.pdfTopLeft, [255,0,0]) && near(out.pdfTopRight, [0,255,0]);

    const r0 = await renderTile(psource, { ...pp, rot: 90 }, sq, sq.tiles[0], 100);
    out.pdfRotated = pick(r0, sq.pageW, sq.margin + 40, sq.margin + top + 40);
    out.rotationOk = near(out.pdfRotated, [0,0,255]);   // bottom-left rotates into top-left

    psource.dispose();
    return out;
  `);

  check('2x2 A4 poster is 380 x 554 mm',
    Math.abs(r.poster[0] - 380) < 0.01 && Math.abs(r.poster[1] - 554) < 0.01, r.poster.join(' x '));
  check('contain-fit spans the whole poster', Math.abs(r.placement[0] - 380) < 0.5, r.placement.join(' x '));
  check('each sheet carries its own quadrant', r.quadrantsCorrect,
    r.tiles.map((t) => `${t.label}:${t.mid}`).join(' '));
  check('printer margins stay white', r.marginsWhite);
  check('overlap strip identical on both sheets', r.overlapMatches,
    `A1 ${r.overlapA1} vs A2 ${r.overlapA2}`);
  check('PDF artwork loads as vector', r.pdf.kind === 'pdf' && r.pdf.w === 400, JSON.stringify(r.pdf));
  check('PDF renders into the right tiles', r.pdfVectorOk, `TL ${r.pdfTopLeft} TR ${r.pdfTopRight}`);
  check('90 degree rotation applies to PDF', r.rotationOk, String(r.pdfRotated));
  check('no page errors', page.errors().length === 0,
    page.errors().map((e) => e.text).join(' | ').slice(0, 300));
}

if (process.argv[1]?.endsWith('tiling.test.js')) main(name, body);
