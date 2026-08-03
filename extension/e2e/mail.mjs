/**
 * Live notification-email E2E for the alignment plan's P3.1 (folder CUD) and
 * P3.2 (resource CUD) redactors.
 *
 * The backend unit tests call the redactors directly with a mocked MailService
 * — they can prove the wiring but NOT that a real transaction actually commits,
 * that the `@Async` + `AFTER_COMMIT` listener really fires, or that anything
 * reaches an SMTP server. This harness closes that gap: every operation is
 * driven through the REAL extension (real E2EE, real JWT, real HTTP) against a
 * running backend, and the assertions are made on what actually lands in a
 * MailHog inbox.
 *
 * What it proves that a mocked test cannot:
 *  - the AFTER_COMMIT listener fires on a COMMITTED transaction (not a rolled
 *    back test one) and the async mail executor delivers;
 *  - recipient resolution over REAL permission rows — notably that a resource
 *    delete mails everyone with access EXCEPT the deleter, while a folder
 *    delete still reaches everyone because the recipients were snapshotted
 *    before the permission rows were physically removed;
 *  - the default-OFF master gates really suppress delivery (asserted against a
 *    proven-live pipeline, so "0 mails" cannot be a broken-SMTP false green);
 *  - per-recipient secret isolation: with show_secret on, each recipient's mail
 *    carries THEIR OWN ciphertext and never another user's.
 *
 * Setup: backend on $JPB_E2E_SERVER (default http://127.0.0.1:8090, `local` H2
 * profile with jpassbolt.email.enabled=true pointing spring.mail at MailHog),
 * MailHog on $JPB_E2E_MAILHOG (default http://127.0.0.1:8025):
 *   docker run -d -p 127.0.0.1:1025:1025 -p 127.0.0.1:8025:8025 mailhog/mailhog
 *
 * NB the assertions are on the zh subject strings because the seeded profiles
 * carry no locale and the server default resolves to zh.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, rpcFrom, provisionAda, makeReporter } from './lib.mjs';

const SHOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'artifacts');
fs.mkdirSync(SHOT, { recursive: true });
const MAILHOG = process.env.JPB_E2E_MAILHOG || 'http://127.0.0.1:8025';
const R = makeReporter();

// ── MailHog client ─────────────────────────────────────────────────────────

const purge = () => fetch(`${MAILHOG}/api/v1/messages`, { method: 'DELETE' });
const inbox = async () =>
  (await (await fetch(`${MAILHOG}/api/v2/messages?limit=200`)).json()).items ?? [];

/** RFC 2047 encoded-word decoder — Chinese subjects arrive as =?UTF-8?B?…?=. */
function decodeWords(s = '') {
  return s
    .replace(/\?=\s+=\?/g, '?==?') // adjacent encoded words: drop the separator
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, _cs, enc, txt) =>
      enc.toUpperCase() === 'B'
        ? Buffer.from(txt, 'base64').toString('utf8')
        : Buffer.from(
            txt.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (__, h) => String.fromCharCode(parseInt(h, 16))),
            'binary',
          ).toString('utf8'),
    );
}

function decodeCte(body = '', cte = '') {
  const e = cte.toLowerCase();
  if (e.includes('base64')) return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
  if (e.includes('quoted-printable')) {
    return Buffer.from(
      body.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))),
      'binary',
    ).toString('utf8');
  }
  return body;
}

const header = (headers, name) => (headers?.[name] ?? [])[0] ?? '';

function bodyOf(m) {
  const parts = m.MIME?.Parts;
  if (parts?.length) {
    return parts.map((p) => decodeCte(p.Body, header(p.Headers, 'Content-Transfer-Encoding'))).join('\n');
  }
  return decodeCte(m.Content?.Body, header(m.Content?.Headers, 'Content-Transfer-Encoding'));
}

const mailOf = (m) => ({
  to: (m.To ?? []).map((t) => `${t.Mailbox}@${t.Domain}`).join(','),
  subject: decodeWords(header(m.Content?.Headers, 'Subject')),
  body: bodyOf(m),
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait for `expected` mails, then keep waiting a little longer so an OVER-send
 * (one mail too many, wrong recipient) is caught instead of being raced past.
 * With expected === 0 there is nothing to wait for, so only the grace window
 * applies — that is the whole point of the gate-off checks.
 */
let lastArrivalMs = -1;
/**
 * Grace window for "no MORE mail arrives". Self-calibrating: the canary step
 * measures real delivery latency and widens this to 4× it. A hardcoded value
 * is what made this harness flaky — a run where the async mail executor took
 * 4.3s (vs the usual ~300ms) blew straight through a fixed 6s window, both
 * thinning the expected-0 margin and letting a late mail from step N land
 * inside step N+1's assertion.
 */
let graceMsDefault = 6000;

async function settle(expected, graceMs = graceMsDefault, timeoutMs = 25000) {
  const started = Date.now();
  const deadline = started + timeoutMs;
  lastArrivalMs = -1;
  while (expected > 0 && Date.now() < deadline) {
    if ((await inbox()).length >= expected) {
      lastArrivalMs = Date.now() - started;
      break;
    }
    await sleep(200);
  }
  await sleep(graceMs);
  return (await inbox()).map(mailOf);
}

/**
 * Empty the inbox, but only once it has stopped growing — a step's own mail
 * must not still be in flight when the NEXT step starts asserting. Counting
 * expected mails per step would be brittle (and wrong the moment a gate
 * changes); waiting for quiet is count-agnostic and directly expresses the
 * property we need. This replaced fixed sleeps, which silently broke on a run
 * where delivery took 4.3s instead of the usual ~300ms.
 */
async function drainUntilQuiet(quietMs = graceMsDefault, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let last = -1;
  let lastChange = Date.now();
  while (Date.now() < deadline) {
    const n = (await inbox()).length;
    if (n !== last) {
      last = n;
      lastChange = Date.now();
    } else if (Date.now() - lastChange >= quietMs) {
      break;
    }
    await sleep(200);
  }
  await purge();
}

/** Compare the delivered {to, subject} set against the expectation, order-free. */
function assertMails(label, got, want) {
  const norm = (a) => a.map((x) => `${x.to} | ${x.subject}`).sort();
  const g = norm(got);
  const w = norm(want);
  if (JSON.stringify(g) === JSON.stringify(w)) {
    R.ok(label, g.length ? g.join('  ///  ') : '0 封（符合预期）');
    return true;
  }
  R.bad(label, `实得 ${g.length} 封:\n    ${g.join('\n    ')}\n  期望 ${w.length} 封:\n    ${w.join('\n    ')}`);
  return false;
}

const PGP = /-----BEGIN PGP MESSAGE-----[\s\S]*?-----END PGP MESSAGE-----/;

// ── run ────────────────────────────────────────────────────────────────────

const { ctx, extId } = await launch(SHOT);
const stamp = Date.now();
/** Assertions a COMPLETE run records — see the catch/finally below. */
const EXPECTED_ASSERTIONS = 18;
let crashed = null;
// Hoisted so the finally-block cleanup can still reach them after a mid-run
// throw: leaving the notification switches on would contaminate the next run,
// which is exactly the repeatability this harness advertises.
let rpc = null;
let gateResourceId = null;

const unwrap = (r) => r?.body ?? r;

/**
 * Did an RPC fail? `rpcFrom` never throws, and the failure arrives in one of
 * TWO shapes depending on which HTTP helper the handler used (see
 * background/http.ts):
 *
 *  - handlers built on `apiCall()` THROW on non-2xx, so background/index.ts
 *    answers `{ok:false, error}` — RESOURCE_SAVE, SHARE_APPLY, …
 *  - the `API_CALL` RPC uses `apiCallRaw()`, which RETURNS a non-2xx envelope
 *    verbatim so the UI can read header.message itself — it arrives as
 *    `{status, header:{status:'error'}, body}` with no `ok` field at all.
 *
 * Checking only the first shape (the obvious one) silently lets every failed
 * API_CALL through, which is the exact hole these guards exist to close.
 */
function rpcFailed(res) {
  if (!res || typeof res !== 'object') return false;
  if (res.ok === false) return true;
  if (res.header && res.header.status === 'error') return true;
  return typeof res.status === 'number' && res.status >= 400;
}

const rpcError = (res) =>
  res?.error ?? res?.header?.message ?? JSON.stringify(res).slice(0, 160);

/**
 * A mutation whose failure must NOT be silent: several assertions here accept
 * an EMPTY INBOX as proof, and a mutation that never happened delivers zero
 * mail just as convincingly as a gate that works.
 */
async function must(msg) {
  const res = await rpc(msg);
  if (rpcFailed(res)) {
    throw new Error(`${msg.type} ${msg.path ?? ''} 失败: ${rpcError(res)}`);
  }
  return unwrap(res);
}

try {
  const drv = await ctx.newPage();
  await drv.goto(`chrome-extension://${extId}/options.html`);
  await drv.waitForLoadState('networkidle');
  rpc = rpcFrom(drv);

  const st = await provisionAda(drv);
  if (st?.phase !== 'unlocked') {
    R.bad('provisioning 失败', JSON.stringify(st).slice(0, 200));
    throw new Error('cannot proceed without a session');
  }
  R.ok('provisioning: ada 已登录', `${st.account.username} verified=${st.account.verified}`);

  const users = unwrap(await rpc({ type: 'API_CALL', method: 'GET', path: '/users.json' })) ?? [];
  const find = (u) => (Array.isArray(users) ? users : []).find((x) => x.username === u);
  const adaUser = find('ada@passbolt.com');
  const betty = find('betty@passbolt.com');
  const edith = find('edith@passbolt.com'); // seeded DISABLED
  if (!betty || !adaUser) throw new Error('缺少 ada/betty 种子用户');
  const ADA = 'ada@passbolt.com';
  const BETTY = 'betty@passbolt.com';

  // ── 0. prove the pipeline is ALIVE before trusting any "0 mails" result ──
  // A gate-off assertion is worthless if SMTP is simply broken: both look like
  // an empty inbox. send_folder_share defaults ON, so this is the canary.
  await purge();
  const canaryFolder = unwrap(
    await rpc({ type: 'API_CALL', method: 'POST', path: '/folders.json', body: { name: `canary-${stamp}` } }),
  );
  await rpc({
    type: 'SHARE_APPLY',
    foreignModel: 'folder',
    foreignId: canaryFolder.id,
    permissions: [{ aro: 'User', aro_foreign_key: betty.id, type: 1, is_new: true }],
  });
  const canary = await settle(1);
  const alive = canary.some((m) => m.to === BETTY && /与您共享了文件夹/.test(m.subject));
  if (alive) R.ok('SMTP 通路存活（默认开启的 folder.share 已投递）', canary.map((m) => m.subject).join(' / '));
  else {
    R.bad('SMTP 通路不通 —— 后续所有「0 封」断言都不可信', JSON.stringify(canary).slice(0, 300));
    throw new Error('mail pipeline dead');
  }
  // Calibrate the "0 mails" grace window against MEASURED latency: an expected-0
  // assertion is only meaningful if we waited comfortably longer than a real
  // mail actually takes. 6s grace vs a typical sub-second async delivery.
  if (lastArrivalMs < 0) {
    R.bad('无法测得投递延迟，「0 封」断言的余量无从判断');
  } else {
    graceMsDefault = Math.max(6000, lastArrivalMs * 4);
    R.ok('「0 封」等待窗已按实测延迟自校准',
      `实测投递 ${lastArrivalMs}ms → 等待 ${graceMsDefault}ms（≥4x）`);
  }
  await rpc({ type: 'API_CALL', method: 'DELETE', path: `/folders/${canaryFolder.id}.json` });
  await drainUntilQuiet();

  // ── 1. a CLOSED master gate really suppresses (pipeline now proven live) ─
  // Set the two gates to false EXPLICITLY rather than relying on the shipped
  // default: the settings row persists in organization_settings, so a second
  // run against the same database would otherwise start with them already on.
  // ("the shipped default is false" is asserted by the backend contract test.)
  await rpc({
    type: 'API_CALL',
    method: 'POST',
    path: '/settings/emails/notifications.json',
    body: { send_password_create: false, send_folder_create: false },
  });
  // Both gate-off checks accept an EMPTY inbox as proof. That is only evidence
  // of a working gate if the triggering mutation actually happened — a folder
  // create that 500s also delivers zero mail. So each one must fail loudly
  // (`must`) and hand back a real id before its assertion is allowed to count.
  await purge();
  const gateFolder = await must({
    type: 'API_CALL', method: 'POST', path: '/folders.json', body: { name: `gate-off-${stamp}` },
  });
  if (!gateFolder?.id) {
    R.bad('P3.1 门控前置不成立：文件夹没建成，"0 封"不能作为门控生效的证据',
      JSON.stringify(gateFolder).slice(0, 200));
  } else {
    assertMails('P3.1 send_folder_create 关闭 → 不发信', await settle(0), []);
  }

  await purge();
  const gateRes = await must({
    type: 'RESOURCE_SAVE',
    mode: 'create',
    input: {
      name: `gate-off-res-${stamp}`,
      username: 'nobody',
      uri: 'https://gate.example.com',
      resourceTypeSlug: 'password-and-description',
      secret: { password: 'gate-off-pw', description: '' },
    },
  });
  gateResourceId = (gateRes?.resource ?? gateRes)?.id ?? gateRes?.id ?? null;
  if (!gateResourceId) {
    R.bad('P3.2 门控前置不成立：密码没建成，"0 封"不能作为门控生效的证据',
      JSON.stringify(gateRes).slice(0, 200));
  } else {
    assertMails('P3.2 send_password_create 关闭 → 不发信', await settle(0), []);
  }

  if (gateFolder?.id) {
    await rpc({ type: 'API_CALL', method: 'DELETE', path: `/folders/${gateFolder.id}.json` });
  }
  await drainUntilQuiet();

  // ── 2. flip the two default-OFF gates on + reveal secrets ───────────────
  // show_secret is what makes the per-recipient isolation check possible.
  const saved = unwrap(
    await rpc({
      type: 'API_CALL',
      method: 'POST',
      path: '/settings/emails/notifications.json',
      body: { send_password_create: true, send_folder_create: true, show_secret: true },
    }),
  );
  if (saved?.send_folder_create === true && saved?.send_password_create === true && saved?.show_secret === true) {
    R.ok('通知开关已打开（folder.create / password.create / show_secret）', `共 ${Object.keys(saved).length} 个键`);
  } else {
    R.bad('通知开关未生效', JSON.stringify(saved).slice(0, 300));
  }

  // ── 3. FOLDER lifecycle (P3.1) ──────────────────────────────────────────
  const fName = `F-${stamp}`;
  await purge();
  const folder = unwrap(
    await rpc({ type: 'API_CALL', method: 'POST', path: '/folders.json', body: { name: fName } }),
  );
  assertMails('P3.1 建文件夹 → 只发给创建者本人', await settle(1), [
    { to: ADA, subject: `您添加了文件夹 ${fName}` },
  ]);

  await purge();
  await rpc({
    type: 'SHARE_APPLY',
    foreignModel: 'folder',
    foreignId: folder.id,
    permissions: [{ aro: 'User', aro_foreign_key: betty.id, type: 7, is_new: true }],
  });
  assertMails('P3.1 共享文件夹 → 只发给新加入者（不回发操作者）', await settle(1), [
    { to: BETTY, subject: `Ada 与您共享了文件夹 ${fName}` },
  ]);

  const fName2 = `${fName}-renamed`;
  await purge();
  await rpc({ type: 'API_CALL', method: 'PUT', path: `/folders/${folder.id}.json`, body: { name: fName2 } });
  assertMails('P3.1 改文件夹 → 全体有权（操作者用「您」，他人用「Ada」）', await settle(2), [
    { to: ADA, subject: `您编辑了文件夹 ${fName2}` },
    { to: BETTY, subject: `Ada 编辑了文件夹 ${fName2}` },
  ]);

  await purge();
  await rpc({ type: 'API_CALL', method: 'DELETE', path: `/folders/${folder.id}.json` });
  // The permission rows are PHYSICALLY gone after this commit — betty can only
  // be reached because FolderDeletedEvent snapshotted the recipients first.
  assertMails('P3.1 删文件夹 → 删前快照的收件人全部收到（含操作者）', await settle(2), [
    { to: ADA, subject: `您删除了文件夹 ${fName2}` },
    { to: BETTY, subject: `Ada 删除了文件夹 ${fName2}` },
  ]);

  // ── 4. RESOURCE lifecycle (P3.2) ────────────────────────────────────────
  const rName = `R-${stamp}`;
  await purge();
  const res = unwrap(
    await rpc({
      type: 'RESOURCE_SAVE',
      mode: 'create',
      input: {
        name: rName,
        username: 'db-admin',
        uri: 'https://secret.example.com',
        resourceTypeSlug: 'password-and-description',
        secret: { password: 'orig-pw-0001', description: 'prod db' },
      },
    }),
  );
  const resourceId = (res?.resource ?? res)?.id ?? res?.id;
  if (!resourceId) throw new Error(`RESOURCE_SAVE 未返回 id: ${JSON.stringify(res).slice(0, 200)}`);
  assertMails('P3.2 建密码 → 只发给创建者本人', await settle(1), [
    { to: ADA, subject: `您添加了密码 ${rName}` },
  ]);

  await purge();
  await rpc({
    type: 'SHARE_APPLY',
    foreignModel: 'resource',
    foreignId: resourceId,
    permissions: [{ aro: 'User', aro_foreign_key: betty.id, type: 7, is_new: true }],
  });
  // Not part of P3.2, but pinned here because the smoke test caught it drifting:
  // PHP uses the operator's FIRST name and a NAMED subject for a v4 row
  // ("{0} shared the resource {1}"), where this used to send the full name and
  // always the generic variant — visibly inconsistent beside the six CUD mails.
  assertMails('共享密码 → 首名 + 具名主题（对齐 PHP，不再是全名/泛指）', await settle(1), [
    { to: BETTY, subject: `Ada 与您共享了资源 ${rName}` },
  ]);

  await purge();
  await rpc({
    type: 'RESOURCE_SAVE',
    mode: 'update',
    resourceId,
    input: {
      name: rName,
      username: 'db-admin',
      uri: 'https://secret.example.com',
      resourceTypeSlug: 'password-and-description',
      secret: { password: 'rotated-pw-9999', description: 'prod db' },
    },
  });
  const upd = await settle(2);
  assertMails('P3.2 改密码 → 全体有权（措辞用「资源」，照搬 PHP 用词差异）', upd, [
    { to: ADA, subject: `您编辑了资源 ${rName}` },
    { to: BETTY, subject: `Ada 编辑了资源 ${rName}` },
  ]);

  // The zero-knowledge assertion. NB comparing the two ciphertext blobs for
  // inequality proves NOTHING — OpenPGP randomises the session key, so two
  // encryptions to the SAME key also differ. The load-bearing check is the
  // RECIPIENT KEY ID inside the PKESK packet: betty's mail must be encrypted to
  // betty's encryption (sub)key and NOT to ada's.
  const adaBody = upd.find((m) => m.to === ADA)?.body ?? '';
  const bettyBody = upd.find((m) => m.to === BETTY)?.body ?? '';
  const adaBlock = (adaBody.match(PGP) ?? [])[0];
  const bettyBlock = (bettyBody.match(PGP) ?? [])[0];
  if (!adaBlock || !bettyBlock) {
    R.bad('P3.2 show_secret 开启后邮件里没有 PGP 密文块', `ada=${!!adaBlock} betty=${!!bettyBlock}`);
  } else {
    const openpgp = await import('openpgp');
    const keys = unwrap(await rpc({ type: 'API_CALL', method: 'GET', path: '/gpgkeys.json' })) ?? [];
    /** Every key id this user can decrypt with (primary + encryption subkeys). */
    const keyIdsOf = async (userId) => {
      const row = (Array.isArray(keys) ? keys : []).find((k) => k.user_id === userId && !k.deleted);
      if (!row?.armored_key) return null;
      const pub = await openpgp.readKey({ armoredKey: row.armored_key });
      // primary + every subkey, spelled defensively across openpgp.js majors
      const ids = new Set([pub.getKeyID().toHex().toLowerCase()]);
      for (const sk of pub.getSubkeys?.() ?? pub.subkeys ?? []) {
        ids.add(sk.getKeyID().toHex().toLowerCase());
      }
      return ids;
    };
    const adaIds = await keyIdsOf(adaUser.id);
    const bettyIds = await keyIdsOf(betty.id);
    const recipientsOf = async (armored) =>
      (await openpgp.readMessage({ armoredMessage: armored }))
        .getEncryptionKeyIDs()
        .map((k) => k.toHex().toLowerCase());
    const adaTo = await recipientsOf(adaBlock);
    const bettyTo = await recipientsOf(bettyBlock);

    if (!adaIds || !bettyIds) {
      R.bad('P3.2 取不到用户公钥，无法判定密文归属', `ada=${!!adaIds} betty=${!!bettyIds}`);
    } else {
      const bettyOk = bettyTo.some((id) => bettyIds.has(id));
      const bettyLeaksToAda = bettyTo.some((id) => adaIds.has(id));
      const adaOk = adaTo.some((id) => adaIds.has(id));
      if (bettyOk && adaOk && !bettyLeaksToAda) {
        R.ok(
          'P3.2 密文按收件人各自公钥加密（PKESK key id 对得上，且 betty 那封不含 ada 的 key id）',
          `ada→${adaTo.join(',')} betty→${bettyTo.join(',')}`,
        );
      } else {
        R.bad(
          'P3.2 严重：邮件密文的收件人密钥不对',
          `betty 密文收件人=${bettyTo.join(',')}（应含 betty 的 ${[...bettyIds].join(',')}），` +
            `ada 密文收件人=${adaTo.join(',')}；bettyOk=${bettyOk} adaOk=${adaOk} 泄给ada=${bettyLeaksToAda}`,
        );
      }
    }
  }

  await purge();
  await rpc({ type: 'API_CALL', method: 'DELETE', path: `/resources/${resourceId}.json` });
  assertMails('P3.2 删密码 → 全体有权但排除删除者本人', await settle(1), [
    { to: BETTY, subject: `Ada 删除了密码 ${rName}` },
  ]);

  // ── 5. cascade folder delete must NOT fan out one mail per child ────────
  // PHP's ResourceDeleteEmailRedactor subscribes only to
  // ResourcesDeleteController::DELETE_SUCCESS_EVENT_NAME, and
  // FoldersDeleteService::deleteResource calls ResourcesTable::softDelete()
  // directly — so a folder delete mails the single folder notice and nothing
  // else, no matter how many passwords it swept. Regression guard for the
  // service-layer event that used to fire per child.
  {
    const cName = `C-${stamp}`;
    const cFolder = unwrap(
      await rpc({ type: 'API_CALL', method: 'POST', path: '/folders.json', body: { name: cName } }),
    );
    const kids = [];
    for (const n of [1, 2]) {
      const kid = unwrap(
        await rpc({
          type: 'RESOURCE_SAVE',
          mode: 'create',
          input: {
            name: `${cName}-kid${n}`,
            resourceTypeSlug: 'password-and-description',
            folderParentId: cFolder.id,
            secret: { password: `kid-pw-${n}`, description: '' },
          },
        }),
      );
      kids.push((kid?.resource ?? kid)?.id ?? kid?.id);
    }
    await rpc({
      type: 'SHARE_APPLY',
      foreignModel: 'folder',
      foreignId: cFolder.id,
      permissions: [{ aro: 'User', aro_foreign_key: betty.id, type: 7, is_new: true }],
    });
    for (const kid of kids.filter(Boolean)) {
      await rpc({
        type: 'SHARE_APPLY',
        foreignModel: 'resource',
        foreignId: kid,
        permissions: [{ aro: 'User', aro_foreign_key: betty.id, type: 7, is_new: true }],
      });
    }
    await drainUntilQuiet();

    // Anti-vacuity guard: if the children were never created (or never landed
    // in the folder) the cascade would sweep nothing and the "no extra mail"
    // assertion below would pass for the wrong reason.
    const live = kids.filter(Boolean);
    const beforeIds = new Set(
      ((unwrap(await rpc({ type: 'API_CALL', method: 'GET', path: '/resources.json' })) ?? []) || [])
        .map((r) => r.id),
    );
    const staged = live.filter((id) => beforeIds.has(id));
    if (staged.length !== 2) {
      R.bad('级联前置条件不成立：两个子密码没建进文件夹，下面的断言会空转', `实得 ${staged.length}/2`);
    }

    await purge();
    await rpc({ type: 'API_CALL', method: 'DELETE', path: `/folders/${cFolder.id}.json?cascade=1` });
    // Expect the two folder-delete notices ONLY — not 2 more "Ada 删除了密码 …".
    assertMails('级联删文件夹 → 只发文件夹那一封，子密码不再逐个发信', await settle(2), [
      { to: ADA, subject: `您删除了文件夹 ${cName}` },
      { to: BETTY, subject: `Ada 删除了文件夹 ${cName}` },
    ]);

    // …and the cascade really did sweep them (soft-deleted → out of the index).
    const afterIds = new Set(
      ((unwrap(await rpc({ type: 'API_CALL', method: 'GET', path: '/resources.json' })) ?? []) || [])
        .map((r) => r.id),
    );
    const survivors = staged.filter((id) => afterIds.has(id));
    if (staged.length === 2 && survivors.length === 0) {
      R.ok('级联确实扫掉了两个子密码（断言非空转）', staged.join(','));
    } else {
      R.bad('级联没有软删子密码，上面的「无额外邮件」不成立', `残留 ${survivors.length}/${staged.length}`);
    }
  }

  // ── 6. disabled users are dropped by RecipientResolver ───────────────────
  if (!edith) {
    R.info('跳过 disabled 收件人检查：种子里没有 edith@passbolt.com');
  } else {
    const dName = `D-${stamp}`;
    const dFolder = unwrap(
      await rpc({ type: 'API_CALL', method: 'POST', path: '/folders.json', body: { name: dName } }),
    );
    await drainUntilQuiet();
    // A try/catch would be dead code here: rpcFrom answers a background failure
    // as {ok:false,error} instead of throwing (lib.mjs), so a rejected share
    // would leave us waiting for mail from a grant that never happened and
    // report a spurious failure. Inspect the result instead.
    const shareRes = await rpc({
      type: 'SHARE_APPLY',
      foreignModel: 'folder',
      foreignId: dFolder.id,
      permissions: [
        { aro: 'User', aro_foreign_key: betty.id, type: 1, is_new: true },
        { aro: 'User', aro_foreign_key: edith.id, type: 1, is_new: true },
      ],
    });
    const shared = !rpcFailed(shareRes);
    if (!shared) {
      // SHARE_APPLY is all-or-nothing, so betty was not granted either — there
      // is nothing to assert. Refusing to share with a suspended account is
      // itself defensible behaviour, so this is reported, not failed.
      R.info(`共享给 disabled 用户被后端整体拒绝，本项无从断言: ${String(rpcError(shareRes)).slice(0, 140)}`);
    }
    if (shared) {
      assertMails('停用用户不收信（edith 已 disabled，只有 betty 收到）', await settle(1), [
        { to: BETTY, subject: `Ada 与您共享了文件夹 ${dName}` },
      ]);
    }
    await rpc({ type: 'API_CALL', method: 'DELETE', path: `/folders/${dFolder.id}.json` }).catch(() => {});
    await sleep(2000);
  }

} catch (err) {
  // Without this, a throw anywhere above (a transient 5xx, the vault re-locking,
  // RESOURCE_SAVE returning {ok:false} so `resourceId` is undefined) would land
  // straight in `finally`, where process.exit() pre-empts the exception: the run
  // would print "10 passed, 0 failed" and exit 0 with a third of the suite never
  // executed. Record it as a failure and re-surface the stack.
  crashed = err;
  R.bad('运行中断，后续断言未执行', String(err?.stack ?? err).slice(0, 500));
} finally {
  // Cleanup MUST live here, not at the end of the try. The notification
  // switches persist in organization_settings, so a throw after they were
  // enabled would leave them on and silently change the next run's behaviour —
  // breaking the repeatability this harness promises. Best-effort throughout:
  // a cleanup failure must never mask the real result.
  if (rpc) {
    if (gateResourceId) {
      await rpc({ type: 'API_CALL', method: 'DELETE', path: `/resources/${gateResourceId}.json` })
        .catch(() => {});
    }
    await rpc({
      type: 'API_CALL',
      method: 'POST',
      path: '/settings/emails/notifications.json',
      body: { send_password_create: false, send_folder_create: false, show_secret: false },
    }).catch((e) => console.error('通知开关恢复失败，下次跑之前请手工复位:', e));
  }
  const fail = R.finish(SHOT, EXPECTED_ASSERTIONS);
  await ctx.close().catch(() => {});
  if (crashed) console.error(crashed);
  process.exit(fail || crashed ? 1 : 0);
}
