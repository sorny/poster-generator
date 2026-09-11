// Loads the uploaded artwork and exposes one uniform interface for it:
//
//   { kind, width, height, preview, pageCount, drawInto(ctx, w, h) }
//
// `width`/`height` are the intrinsic size (pixels for a bitmap, points for a
// PDF page). `preview` is a cheap bitmap for the interactive canvas.
// `drawInto` paints the artwork into the unit rectangle (0,0)-(w,h) of the
// current transform, at whatever resolution that transform implies. For PDFs
// that re-runs the vector renderer, so exported tiles stay sharp at any size.

import * as pdfjs from '../vendor/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

const PREVIEW_MAX = 1600;
const IMAGE_TYPES = /^image\/(png|jpeg|jpg|webp|gif|bmp|avif)$/i;

export async function loadSource(file, onProgress = () => {}) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (isPdf) return loadPdf(file, onProgress);
  if (IMAGE_TYPES.test(file.type) || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name)) {
    return loadImage(file);
  }
  throw new Error(
    `Cannot read ${file.name}. Use a PNG, JPEG, WebP, GIF or PDF file.`,
  );
}

async function loadImage(file) {
  const bitmap = await createImageBitmap(await fileToBlob(file));
  const preview = await downscale(bitmap, PREVIEW_MAX);
  return {
    kind: 'image',
    name: file.name,
    width: bitmap.width,
    height: bitmap.height,
    pageCount: 1,
    pageNumber: 1,
    preview,
    resolutionNote: `${bitmap.width} x ${bitmap.height} px`,
    async drawInto(ctx, w, h) {
      ctx.drawImage(bitmap, 0, 0, w, h);
    },
    async selectPage() { /* images have a single page */ },
    dispose() { bitmap.close?.(); preview.close?.(); },
  };
}

async function loadPdf(file, onProgress) {
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data, isEvalSupported: false });
  const doc = await task.promise;

  const source = {
    kind: 'pdf',
    name: file.name,
    pageCount: doc.numPages,
    pageNumber: 1,
    width: 0, height: 0, preview: null,
    resolutionNote: '',
    async drawInto(ctx, w, h) {
      // pdf.js multiplies onto the context transform already in place, so the
      // caller's translate/rotate/scale survives.
      const viewport = source._page.getViewport({ scale: w / source.width });
      await source._page.render({ canvasContext: ctx, viewport }).promise;
    },
    async selectPage(n) {
      onProgress(`Rendering page ${n}…`);
      source._page = await doc.getPage(n);
      const vp = source._page.getViewport({ scale: 1 });
      source.pageNumber = n;
      source.width = vp.width;
      source.height = vp.height;
      source.preview?.close?.();
      source.preview = await renderPdfPreview(source._page, vp);
      source.resolutionNote = `vector, ${(vp.width / 72 * 25.4).toFixed(0)} x ${(vp.height / 72 * 25.4).toFixed(0)} mm`;
    },
    // destroy() lives on the loading task; the proxy only offers cleanup().
    dispose() { source.preview?.close?.(); task.destroy(); },
  };

  await source.selectPage(1);
  return source;
}

async function renderPdfPreview(page, baseViewport) {
  const scale = Math.min(PREVIEW_MAX / Math.max(baseViewport.width, baseViewport.height), 4);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return createImageBitmap(canvas);
}

async function downscale(bitmap, max) {
  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest <= max) return createImageBitmap(bitmap);
  const scale = max / longest;
  return createImageBitmap(bitmap, {
    resizeWidth: Math.round(bitmap.width * scale),
    resizeHeight: Math.round(bitmap.height * scale),
    resizeQuality: 'high',
  });
}

function fileToBlob(file) {
  // Safari refuses createImageBitmap on some File instances; a plain Blob works.
  return file instanceof Blob ? file : new Blob([file]);
}
