/**
 * Shared E2E harness for the JPassbolt extension.
 *
 * Loads the built extension (dist/) into a REAL Chrome for Testing — the
 * headless_shell chromium playwright ships by default cannot load extensions,
 * so we discover a full chromium in playwright's cache and refuse to run
 * without one. Account provisioning is driven through the background RPCs
 * (SET_SERVER → SETUP_IMPORT_KEY → SETUP_COMMIT → UNLOCK) because the options
 * page no longer offers arbitrary key import (official parity: real
 * provisioning goes through an emailed setup/recovery token). The FEATURES
 * under test are always driven through the real UI.
 *
 * Requires Node ≥ 20 (undici's `File` global) — the same constraint as
 * `npm run build`. Backend must be reachable at $JPB_E2E_SERVER (default
 * http://127.0.0.1:8090), i.e. the api repo's `local` H2 profile seeded by
 * DataInitializer (ada@passbolt.com holds the committed dev server key).
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EXT_DIST = path.resolve(HERE, '..', 'dist');
export const SERVER = process.env.JPB_E2E_SERVER || 'http://127.0.0.1:8090';

// ada@passbolt.com signs in with her OWN committed dev key (DataInitializer
// @Profile local seeds ada's gpgkey from ada_public.asc) + passphrase "password".
// NB: this used to be the SERVER key (server_private.asc) — that one-key-for-all
// dev shortcut was untangled so the server identity key no longer doubles as a
// user login key. GpgAuth stage-1 matches the user by fingerprint, so ada must
// sign in with ada_private.asc, not the server key.
export const ADA = {
  keyPath:
    process.env.JPB_E2E_KEY ||
    path.resolve(HERE, '..', '..', '..', 'jpassbolt_api', 'src', 'main', 'resources', 'gpg', 'ada_private.asc'),
  passphrase: 'password',
  username: 'ada@passbolt.com',
  fullName: 'Ada Lovelace',
};
// carol@passbolt.com is a seeded PENDING user + fixed register token, so the
// /setup complete-mode flow can be exercised end-to-end without a live mailbox.
export const CAROL_REGISTER_TOKEN = 'd4c0c497-be4f-47c5-8f50-cb618a4a1d32';

/** Locate a FULL Chrome/Chromium in playwright's cache (never headless_shell). */
export function findFullChromium() {
  if (process.env.JPB_E2E_CHROME) return process.env.JPB_E2E_CHROME;
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'); // macOS
  const linux = path.join(os.homedir(), '.cache', 'ms-playwright');
  const root = fs.existsSync(cache) ? cache : linux;
  if (!fs.existsSync(root)) return null;
  const dirs = fs
    .readdirSync(root)
    .filter((d) => /^chromium-\d+$/.test(d)) // exclude chromium_headless_shell-*
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of dirs) {
    for (const rel of [
      'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
      'chrome-linux/chrome',
    ]) {
      const p = path.join(root, d, rel);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

/** Simple assertion collector with a non-zero exit on any failure. */
export function makeReporter() {
  const results = [];
  return {
    ok: (n, d = '') => { results.push(['PASS', n, d]); console.log(`✅ ${n}${d ? ' — ' + d : ''}`); },
    bad: (n, d = '') => { results.push(['FAIL', n, d]); console.log(`❌ ${n}${d ? ' — ' + d : ''}`); },
    info: (m) => console.log('ℹ️  ' + m),
    /**
     * `expected` is the number of assertions a COMPLETE run records. Without it
     * a run that threw halfway reports "N passed, 0 failed" and exits 0 — the
     * unrecorded remainder is indistinguishable from a clean pass, so a crash
     * in the middle reads as green. Pass it and a short run is itself a failure.
     */
    finish(shotDir, expected = 0) {
      const pass = results.filter((r) => r[0] === 'PASS').length;
      let fail = results.filter((r) => r[0] === 'FAIL').length;
      const total = results.length;
      console.log('\n================ 汇总 ================');
      for (const [s, n, d] of results) console.log(`${s === 'PASS' ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`);
      if (expected && total < expected) {
        console.log(`❌ 断言数不足：只跑了 ${total}/${expected} 项 —— 用例中途中断，其余从未执行`);
        fail += 1;
      }
      console.log(`\n${pass} passed, ${fail} failed`);
      if (shotDir) {
        fs.writeFileSync(
          path.join(shotDir, 'e2e-results.json'),
          JSON.stringify({ pass, fail, total, expected, results }, null, 2),
        );
      }
      return fail;
    },
  };
}

/** Launch a persistent context with the extension loaded; returns {ctx, extId}. */
export async function launch(shotDir) {
  const exe = findFullChromium();
  if (!exe) {
    console.error(
      '\n无法找到可加载扩展的完整 Chromium。\n' +
        'playwright 默认的 headless_shell 不能加载扩展，需要完整版：\n' +
        '  npx playwright install chromium\n' +
        '或用环境变量指定：JPB_E2E_CHROME=/path/to/chrome node e2e/all.mjs\n',
    );
    process.exit(2);
  }
  if (!fs.existsSync(path.join(EXT_DIST, 'manifest.json'))) {
    console.error(`\ndist/ 未构建（缺 manifest.json）。先 \`npm run build\`（需 Node ≥ 20）。\n`);
    process.exit(2);
  }
  const ctx = await chromium.launchPersistentContext(path.join(shotDir, 'profile-' + Date.now()), {
    executablePath: exe,
    headless: true,
    args: [`--disable-extensions-except=${EXT_DIST}`, `--load-extension=${EXT_DIST}`, '--headless=new', '--no-sandbox'],
    viewport: { width: 1280, height: 900 },
  });
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 20000 }));
  const extId = new URL(sw.url()).host;
  return { ctx, extId, chromePath: exe };
}

/** Attach /api/ request + 400-response recorders to a context. */
export function trackApi(ctx) {
  const calls = [];
  const bad400 = [];
  ctx.on('request', (r) => { if (r.url().includes('/api/')) calls.push(r.url()); });
  ctx.on('response', (r) => { if (r.url().includes('/api/') && r.status() === 400) bad400.push(r.url()); });
  return { calls, bad400 };
}

/** RPC helper: chrome.runtime.sendMessage from an extension page, unwrapped. */
export function rpcFrom(page) {
  return async (msg) => {
    const r = await page.evaluate((m) => chrome.runtime.sendMessage(m), msg);
    return r && r.ok ? r.data : r; // background wraps success as {ok, data}
  };
}

/** Full ada sign-in via RPC (server + staged key + commit + unlock). */
export async function provisionAda(page) {
  const rpc = rpcFrom(page);
  const key = fs.readFileSync(ADA.keyPath, 'utf8');
  await rpc({ type: 'SET_SERVER', serverUrl: SERVER });
  await rpc({ type: 'SETUP_IMPORT_KEY', armoredPrivateKey: key });
  await rpc({
    type: 'SETUP_COMMIT',
    account: { userId: '', username: ADA.username, fullName: ADA.fullName },
    allowReplace: true,
  });
  return rpc({ type: 'UNLOCK', passphrase: ADA.passphrase });
}
