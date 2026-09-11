// Refreshes vendor/ from node_modules after `npm install`.
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const FILES = [
  ['node_modules/pdfjs-dist/legacy/build/pdf.min.mjs', 'vendor/pdf.min.mjs'],
  ['node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', 'vendor/pdf.worker.min.mjs'],
  ['node_modules/pdf-lib/dist/pdf-lib.esm.min.js', 'vendor/pdf-lib.esm.min.js'],
];

await mkdir(resolve(ROOT, 'vendor'), { recursive: true });
for (const [from, to] of FILES) {
  await copyFile(resolve(ROOT, from), resolve(ROOT, to));
  console.log(`vendored ${to}`);
}
