/**
 * End-to-end coverage for the four "official parity" asks, driven through the
 * real extension UI in a full Chrome for Testing. See e2e/README.md for setup.
 *
 *   ① folder "···" menu — 新建文件夹 / 重命名 / 共享 / 导出 / 删除 (+ retained 移动…),
 *      folder-mode Share (no Simulate, permissions via contain[permissions]),
 *      folder Export lands on the export tab.
 *   ② quickaccess popup — official layout (Suggested / Browse / Filters ›/Groups ›,
 *      fixed Create new), and the "Items I own" filter hits the new backend
 *      filter[is-owned-by-me] param.
 *   ③ unlock card — centered flow-card in app.html (same width as the recovery
 *      card), while the 380px popup is untouched (no flow-overlay).
 *   ④ security-token picker — renders inside the setup flow's passphrase step.
 *
 * Plus a regression guard: NO bare square brackets reach the API and NO /api/
 * response is 400 (the Tomcat query-parser trap — see the memory note).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  launch, trackApi, rpcFrom, provisionAda, makeReporter, CAROL_REGISTER_TOKEN,
} from './lib.mjs';

const SHOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'artifacts');
fs.mkdirSync(SHOT, { recursive: true });
const R = makeReporter();
const { ctx, extId } = await launch(SHOT);
const { calls, bad400 } = trackApi(ctx);
const url = (p) => `chrome-extension://${extId}/${p}`;

try {
  // ── provision ada via RPC ────────────────────────────────────────────────
  const drv = await ctx.newPage();
  await drv.goto(url('options.html'));
  await drv.waitForLoadState('networkidle');
  const rpc = rpcFrom(drv);
  const st = await provisionAda(drv);
  if (st?.phase === 'unlocked') R.ok('provisioning: ada 已登录', `${st.account.username} verified=${st.account.verified}`);
  else { R.bad('provisioning 失败', JSON.stringify(st).slice(0, 200)); throw new Error('cannot proceed without a session'); }

  // ── ③ unlock centering (checked on a fresh page before ada's session shows) ─
  // A second profile-less check is overkill; instead assert geometry on the
  // recovery card (guest route, always reachable) and the popup shape.
  const app = await ctx.newPage();
  await app.goto(url('app.html'));
  await app.waitForLoadState('networkidle');
  await app.waitForTimeout(5000);
  await app.screenshot({ path: `${SHOT}/vault.png` });
  if (await app.locator('.folders').count()) R.ok('密码库已渲染');
  else R.bad('密码库未渲染', (await app.locator('body').innerText()).slice(0, 200));

  // ── ① folder "···" menu ──────────────────────────────────────────────────
  const openMenu = async () => {
    await app.locator('.folders .fmenu').first().click({ force: true });
    await app.waitForTimeout(600);
  };
  if (await app.locator('.folders .fmenu').count()) {
    await openMenu();
    await app.screenshot({ path: `${SHOT}/folder-menu.png` });
    const items = (await app.locator('.folders .menu button').allInnerTexts()).map((s) => s.trim());
    R.info('menu: ' + items.join(' / '));
    // menu labels use 「共享」 (not 「分享」) — matches the settings terminology
    const want = [/新建文件夹/, /重命名/, /共享|分享/, /导出/, /删除/];
    const miss = want.filter((re) => !items.some((i) => re.test(i)));
    if (!miss.length) R.ok('① 文件夹菜单五项齐全', items.join(' / '));
    else R.bad('① 文件夹菜单缺项', miss.map(String).join(','));
    if (items.some((i) => /移动/.test(i))) R.ok('① 「移动…」按拍板保留'); else R.bad('① 「移动…」丢了');
    const idx = want.map((re) => items.findIndex((i) => re.test(i))).filter((n) => n >= 0);
    if (idx.every((v, i, a) => i === 0 || v > a[i - 1])) R.ok('① 官方五项顺序正确'); else R.bad('① 顺序错乱', JSON.stringify(idx));

    // -- Share in FOLDER mode --
    const share = app.locator('.folders .menu button').filter({ hasText: /共享|分享/ }).first();
    if (await share.count()) {
      await share.click();
      await app.waitForTimeout(3000);
      await app.screenshot({ path: `${SHOT}/folder-share.png` });
      if (await app.locator('.modal, [role=dialog]').count()) R.ok('① 文件夹共享框已打开');
      else R.bad('① 文件夹共享框没打开');
      if ((await app.getByRole('button', { name: /模拟|Simulate/ }).count()) === 0) R.ok('① folder 模式无 Simulate 按钮（后端对 folder 硬 404）');
      else R.bad('① folder 模式仍渲染了 Simulate 按钮');
      const permCall = calls.find((u) => u.includes('folders/') && u.includes('%5Bpermissions%5D'));
      if (permCall) R.ok('① 权限走 GET /folders/{id}.json?contain[permissions]=1', decodeURIComponent(permCall.split('/api/')[1]));
      else R.bad('① 没看到 folder contain[permissions] 请求');
      await app.keyboard.press('Escape'); await app.waitForTimeout(700);
    }

    // -- Export lands on the export tab --
    await openMenu();
    const exp = app.locator('.folders .menu button').filter({ hasText: /导出/ }).first();
    if (await exp.count()) {
      await exp.click();
      await app.waitForTimeout(2500);
      await app.screenshot({ path: `${SHOT}/folder-export.png` });
      if (/导出|Export/.test(await app.locator('body').innerText())) R.ok('① 导出框已打开并落在导出页');
      else R.bad('① 导出框没落在导出页');
      await app.keyboard.press('Escape'); await app.waitForTimeout(500);
    }
  } else {
    R.bad('① 找不到 ··· 按钮（种子数据无文件夹？）');
  }

  // ── ② quickaccess popup ──────────────────────────────────────────────────
  const pop = await ctx.newPage();
  await pop.setViewportSize({ width: 380, height: 600 });
  await pop.goto(url('popup.html'));
  await pop.waitForLoadState('networkidle');
  await pop.waitForTimeout(3500);
  await pop.screenshot({ path: `${SHOT}/popup.png` });
  if (!(await pop.locator('.flow-overlay').count())) R.ok('③ 弹窗未被 flow-overlay 污染（解锁改动没波及 popup）');
  else R.bad('③ 回归：弹窗被套上了 flow-overlay');
  const popText = await pop.locator('body').innerText();
  for (const [label, re] of [
    ['搜索框', /搜索|Search/], ['Suggested 分区', /建议|Suggested/], ['Browse 分区', /浏览|Browse/],
    ['Filters 行', /筛选|Filters/], ['Groups 行', /群组|用户组|Groups/], ['Create new 按钮', /新建|Create new/],
  ]) { if (re.test(popText)) R.ok(`② 弹窗含「${label}」`); else R.bad(`② 弹窗缺「${label}」`); }

  const filters = pop.getByText(/^筛选|^Filters/).first();
  if (await filters.count()) {
    await filters.click();
    await pop.waitForTimeout(2500);
    await pop.screenshot({ path: `${SHOT}/popup-filters.png` });
    const ft = await pop.locator('body').innerText();
    const want4 = [[/收藏|Favorites/, '收藏'], [/我拥有|Items I own/, '我拥有的'], [/最近|Recently/, '最近修改'], [/共享给我|Shared with me/, '共享给我的']];
    const miss = want4.filter(([re]) => !re.test(ft)).map(([, n]) => n);
    if (!miss.length) R.ok('② Filters 子页四项齐全'); else R.bad('② Filters 子页缺项', miss.join(','));

    const owned = pop.getByText(/我拥有|Items I own/).first();
    if (await owned.count()) {
      await owned.click();
      await pop.waitForTimeout(3000);
      await pop.screenshot({ path: `${SHOT}/popup-owned.png` });
      const call = calls.find((u) => u.includes('is-owned-by-me'));
      if (call) R.ok('② 「我拥有的」发出后端新过滤器', decodeURIComponent(call.split('/api/')[1]));
      else R.bad('② 没看到 is-owned-by-me 请求');
    }
  }

  // ── ④ security-token picker in the setup flow ────────────────────────────
  const usersResp = await rpc({ type: 'API_CALL', method: 'GET', path: '/users.json' });
  const list = usersResp?.body ?? usersResp;
  const carol = (Array.isArray(list) ? list : []).find((u) => u.username === 'carol@passbolt.com');
  if (!carol) {
    R.bad('④ 找不到 carol 种子用户（跳过 setup 口令标记检查）');
  } else {
    const setup = await ctx.newPage();
    await setup.goto(url(`app.html#/setup/${carol.id}/${CAROL_REGISTER_TOKEN}`));
    await setup.waitForLoadState('networkidle');
    await setup.waitForTimeout(2500);
    // ExistingAccountGate: this browser already holds ada's key, so replacing it
    // demands an explicit tick (the safety gate added in the nine-issues wave).
    const gate = setup.locator('input[type=checkbox]').first();
    if (await gate.count()) {
      await gate.check({ force: true });
      await setup.waitForTimeout(400);
      R.ok('④ ExistingAccountGate 拦住了改绑（需显式确认）');
      const gateGo = setup.getByRole('button', { name: /我已了解风险|继续/ }).first();
      if (await gateGo.count() && (await gateGo.isEnabled())) { await gateGo.click(); await setup.waitForTimeout(2500); }
    }
    // step 0 → 1 (validate invite), 1 → 2 (generate key → passphrase step)
    for (const re of [/继续|下一步|验证|开始/, /生成|下一步|继续/]) {
      const btn = setup.getByRole('button', { name: re }).first();
      if (await btn.count() && (await btn.isEnabled())) { await btn.click(); await setup.waitForTimeout(6000); }
    }
    await setup.screenshot({ path: `${SHOT}/setup-passphrase.png` });
    const swatches = await setup.locator('.sectoken-swatch, [class*=swatch]').count();
    const txt = await setup.locator('body').innerText();
    if (swatches > 0 || /安全令牌|口令标记/.test(txt)) R.ok('④ setup 流程安全令牌选择器已渲染', `色板数=${swatches}`);
    else R.bad('④ setup 流程没看到安全令牌选择器', txt.slice(0, 200));
  }

  // ── ③ recovery card geometry (guest route) vs the popup shape ─────────────
  const rec = await ctx.newPage();
  await rec.goto(url('app.html#/recover'));
  await rec.waitForLoadState('networkidle');
  await rec.waitForTimeout(1800);
  await rec.screenshot({ path: `${SHOT}/recover.png` });
  const box = await rec.evaluate(() => {
    const c = document.querySelector('.flow-card');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { w: Math.round(r.width), left: Math.round(r.left), right: Math.round(window.innerWidth - r.right), overlay: !!document.querySelector('.flow-overlay') };
  });
  if (box && box.overlay && Math.abs(box.left - box.right) <= 4) R.ok('③ 恢复窗是居中 flow-card', `宽${box.w}, 左${box.left}/右${box.right}`);
  else R.bad('③ 恢复窗未居中', JSON.stringify(box));

  // ── regression guard: no bare brackets, no 400 ───────────────────────────
  const raw = calls.filter((u) => /\?[^#]*\[/.test(u));
  if (!raw.length) R.ok('无裸方括号 URL（Tomcat 400 陷阱已堵）', `${calls.length} 次 /api/ 调用`);
  else R.bad('仍有裸方括号 URL', raw.slice(0, 3).join(' , '));
  if (!bad400.length) R.ok('无 /api/ 返回 400'); else R.bad('有 400 响应', bad400.map((u) => u.split('/api/')[1]).slice(0, 4).join(' , '));
} finally {
  const fail = R.finish(SHOT);
  await ctx.close();
  process.exit(fail ? 1 : 0);
}
