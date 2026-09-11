// Minimal Chrome DevTools Protocol driver. No test framework, no browser
// automation dependency: Node's built-in WebSocket talks to a headless Chrome
// that the machine already has. Enough to load the app, run scripts inside it,
// read pixels back and capture downloads.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Locate a Chrome build. Set CHROME_PATH to override. Playwright's cached
 * "Chrome for Testing" is preferred because it is version-stable; a normal
 * Chrome install works just as well.
 */
export function findChrome() {
  const candidates = [process.env.CHROME_PATH].filter(Boolean);

  const cache = join(process.env.HOME ?? '', 'Library/Caches/ms-playwright');
  const linuxCache = join(process.env.HOME ?? '', '.cache/ms-playwright');
  for (const dir of [cache, linuxCache]) {
    if (!existsSync(dir)) continue;
    const builds = readdirSync(dir)
      .filter((name) => name.startsWith('chromium-'))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const build of builds) {
      candidates.push(
        join(dir, build, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
        join(dir, build, 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
        join(dir, build, 'chrome-linux/chrome'),
      );
    }
  }

  candidates.push(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  );

  const found = candidates.find((path) => path && existsSync(path));
  if (!found) {
    throw new Error(
      'No Chrome found. Install Google Chrome, or set CHROME_PATH to a Chrome/Chromium binary.',
    );
  }
  return found;
}

/** Launch headless Chrome on `url` and attach to its page target. */
export async function launch(url, { downloadPath, port = 9333 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'poster-profile-'));
  const proc = spawn(findChrome(), [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--window-size=1440,900',
    // CI containers run as root, where Chrome's sandbox refuses to start.
    ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
    url,
  ], { stdio: 'ignore' });

  let target;
  for (let i = 0; i < 100 && !target; i++) {
    await sleep(200);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch { /* not listening yet */ }
  }
  if (!target) {
    proc.kill();
    throw new Error('Chrome did not expose a debugging target');
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      logs.push({ level: msg.params.type, text: msg.params.args.map(describe).join(' ') });
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const details = msg.params.exceptionDetails;
      logs.push({ level: 'pageerror', text: details.exception?.description ?? details.text });
    }
  };

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  if (downloadPath) {
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath, eventsEnabled: true });
  }

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  };

  return {
    send,
    evaluate,
    logs,
    /**
     * Top-level `const` in Runtime.evaluate persists across calls and collides
     * on the next one, so every snippet runs inside its own function scope.
     */
    run: (body) => evaluate(`(() => { ${body} })()`),
    runAsync: (body) => evaluate(`(async () => { ${body} })()`),
    errors: () => logs.filter((l) => l.level === 'pageerror' || l.level === 'error'),
    screenshot: async (path) => {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path, Buffer.from(data, 'base64'));
    },
    close: () => {
      try { ws.close(); } catch { /* already gone */ }
      proc.kill();
      // Chrome is still flushing its profile as it exits, so removal races it.
      // Retry briefly and give up quietly — it is a temp directory either way.
      try {
        rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 60 });
      } catch { /* the OS will reap it */ }
    },
  };
}

const describe = (arg) => (arg.value !== undefined ? String(arg.value) : arg.description ?? arg.type);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
