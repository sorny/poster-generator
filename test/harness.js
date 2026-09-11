// Suite plumbing: boot the app's own static server on a free port, drive it
// with a headless browser, collect pass/fail lines.

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launch, sleep } from './cdp.js';

export { sleep };
export const ROOT = resolve(import.meta.dirname, '..');

const freePort = () => new Promise((res, rej) => {
  const probe = createServer();
  probe.on('error', rej);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => res(port));
  });
});

async function waitForServer(port) {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/index.html`);
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`server on ${port} never came up`);
}

/**
 * Run one suite against a freshly served copy of the app.
 * `body({ page, check, downloads, artifacts })` does the work; `check` records
 * a result rather than throwing, so one bad assertion does not hide the rest.
 */
export async function suite(name, body) {
  // Two independent ports. Deriving the debug port as `port + 1000` looked fine
  // until the OS handed out an ephemeral port above 64535, where the sum passes
  // 65535, Chrome refuses to listen and every suite fails at once.
  const [port, debugPort] = [await freePort(), await freePort()];
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: String(port) },
  });
  const downloads = mkdtempSync(join(tmpdir(), 'poster-downloads-'));
  const artifacts = mkdtempSync(join(tmpdir(), 'poster-artifacts-'));
  const results = [];
  const check = (label, ok, detail = '') => {
    results.push({ label, ok, detail });
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  };

  let page;
  try {
    await waitForServer(port);
    page = await launch(`http://127.0.0.1:${port}`, { downloadPath: downloads, port: debugPort });
    await sleep(2200); // module graph + first render
    await body({ page, check, downloads, artifacts, port });
  } catch (err) {
    check(`${name} harness`, false, err.message);
  } finally {
    page?.close();
    server.kill();
    for (const dir of [downloads, artifacts]) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
      } catch { /* temp dirs; not worth failing a suite over */ }
    }
  }
  return results;
}

/** Poll a directory until a file matching `match` appears. */
export async function waitForFile(dir, match, timeoutMs = 60000) {
  const { readdirSync } = await import('node:fs');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = readdirSync(dir).find(match);
    if (hit) {
      await sleep(1200); // let the write finish
      return hit;
    }
    await sleep(300);
  }
  return null;
}

/**
 * Load an exported PDF with the same library the app writes it with. Uses the
 * committed vendor build, so the tests run without `npm install`.
 */
export async function loadPdf(path) {
  const { readFileSync } = await import('node:fs');
  const { PDFDocument } = await import(
    new URL('../vendor/pdf-lib.esm.min.js', import.meta.url).href
  );
  return PDFDocument.load(readFileSync(path));
}

/**
 * Run a suite that needs no browser. `js/layout.js` is pure and DOM free, so its
 * tests import it directly and finish in milliseconds.
 */
export async function plainSuite(name, body) {
  const results = [];
  const check = (label, ok, detail = '') => {
    results.push({ label, ok, detail });
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  };
  try {
    await body({ check });
  } catch (err) {
    check(`${name} harness`, false, err.message);
  }
  return results;
}

/** Standalone entry point for a single suite file. */
export async function main(name, body, { browser = true } = {}) {
  console.log(`\n${name}`);
  const results = browser ? await suite(name, body) : await plainSuite(name, body);
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `\n${failed.length} failed` : `\n${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
