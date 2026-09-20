// Offline regression for the actual packaged content script, including its
// closed shadow root. Requires a build and full Chromium, but no backend.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './lib.mjs';

const artifacts = path.join(path.dirname(fileURLToPath(import.meta.url)), 'artifacts', 'brand');
fs.mkdirSync(artifacts, { recursive: true });
const { ctx } = await launch(artifacts);
const results = [];

async function badge(cdp) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  function find(node) {
    const attrs = node.attributes ?? [];
    const index = attrs.indexOf('class');
    if (node.nodeName === 'BUTTON' && index >= 0 && attrs[index + 1].split(' ').includes('cta')) return node;
    for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) {
      const found = find(child);
      if (found) return found;
    }
  }
  const node = find(root);
  if (!node) return null;
  const { object } = await cdp.send('DOM.resolveNode', { nodeId: node.nodeId });
  try {
    const { result } = await cdp.send('Runtime.callFunctionOn', {
      objectId: object.objectId, returnByValue: true,
      functionDeclaration: `function () {
        const img = this.querySelector('img');
        const fallback = this.querySelector('.brand-fallback');
        return { src: img?.src, width: img?.naturalWidth ?? 0,
          fallback: fallback?.textContent, visible: this.getBoundingClientRect().width > 0,
          fallbackVisible: !!fallback && getComputedStyle(fallback).display !== 'none' };
      }`,
    });
    return result.value;
  } finally { await cdp.send('Runtime.releaseObject', { objectId: object.objectId }); }
}

async function waitBadge(cdp, predicate) {
  let last;
  for (let i = 0; i < 100; i++) {
    last = await badge(cdp);
    if (last && predicate(last)) return last;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Badge did not reach expected state: ${JSON.stringify(last)}`);
}

try {
  for (const strict of [false, true]) {
    const page = await ctx.newPage();
    const wrongRequests = [];
    await page.route('https://jpb-autofill.test/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname !== '/login') {
        wrongRequests.push(url.href);
        return route.fulfill({ status: 404, body: 'No assets belong to this login site' });
      }
      return route.fulfill({
        contentType: 'text/html',
        headers: strict ? { 'Content-Security-Policy': "img-src 'none'; connect-src 'none'" } : {},
        body: '<!doctype html><title>Autofill regression</title><input aria-label="Password" type="password" style="width:280px;height:40px">',
      });
    });
    await page.goto('https://jpb-autofill.test/login');
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-jpassbolt-extension'));
    await page.waitForTimeout(300);
    await page.getByLabel('Password').focus();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('DOM.enable');
    const state = await waitBadge(cdp, x => strict ? x.width > 0 || x.fallbackVisible : x.width > 0);
    assert.equal(state.visible, true);
    assert.equal(wrongRequests.length, 0, `Icon requested from login site: ${wrongRequests}`);
    if (state.src) assert.match(state.src, /^chrome-extension:\/\//);
    if (!strict) assert.equal(state.width, 128);
    results.push({ strict, ...state });

    // Exercise a resource failure deterministically even when this Chromium
    // exempts extension URLs from the host img-src policy.
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    function imageNode(n) {
      if (n.nodeName === 'IMG' && (n.attributes ?? []).includes('brand-icon')) return n;
      for (const child of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) {
        const found = imageNode(child); if (found) return found;
      }
    }
    const img = imageNode(root);
    if (img) {
      const { object } = await cdp.send('DOM.resolveNode', { nodeId: img.nodeId });
      await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId,
        functionDeclaration: 'function () { this.dispatchEvent(new Event("error")); }' });
      await cdp.send('Runtime.releaseObject', { objectId: object.objectId });
    }
    const fallback = await waitBadge(cdp, x => x.fallbackVisible);
    assert.equal(fallback.fallback, 'JP');
    assert.equal(fallback.visible, true);
    results.push({ strict, forcedFailure: true, ...fallback });
    await page.screenshot({ path: path.join(artifacts, strict ? 'strict-fallback.png' : 'fallback.png') });
    await cdp.detach();
    await page.close();
  }
  console.log(JSON.stringify(results, null, 2));
  console.log('PASS: packaged badge loads from extension; strict CSP and resource failures retain a visible entry point');
} finally { await ctx.close(); }
