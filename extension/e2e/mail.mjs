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
async function settle(expected, graceMs = 6000, timeoutMs = 25000) {
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

try {
  const drv = await ctx.newPage();
  await drv.goto(`chrome-extension://${extId}/options.html`);
  await drv.waitForLoadState('networkidle');
  const rpc = rpcFrom(drv);
  const unwrap = (r) => r?.body ?? r;

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
  const GRACE_MS = 6000;
  if (lastArrivalMs >= 0 && lastArrivalMs * 4 < GRACE_MS) {
    R.ok('「0 封」等待窗足够宽', `实测投递 ${lastArrivalMs}ms，等待 ${GRACE_MS}ms（>4x）`);
  } else {
    R.bad('「0 封」等待窗可能不够宽 —— 门控断言存在假绿风险', `实测投递 ${lastArrivalMs}ms，等待仅 ${GRACE_MS}ms`);
  }
  await rpc({ type: 'API_CALL', method: 'DELETE', path: `/folders/${canaryFolder.id}.json` });
  await sleep(2500);

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
  await purge();
  const gateFolder = unwrap(
    await rpc({ type: 'API_CALL', method: 'POST', path: '/folders.json', body: { name: `gate-off-${stamp}` } }),
  );
  assertMails('P3.1 send_folder_create 关闭 → 不发信', await settle(0), []);

  await purge();
  const gateRes = unwrap(
    await rpc({
      type: 'RESOURCE_SAVE',
      mode: 'create',
      input: {
        name: `gate-off-res-${stamp}`,
        username: 'nobody',
        uri: 'https://gate.example.com',
        resourceTypeSlug: 'password-and-description',
        secret: { password: 'gate-off-pw', description: '' },
      },
    }),
  );
  assertMails('P3.2 send_password_create 关闭 → 不发信', await settle(0), []);
  await rpc({ type: 'API_CALL', method: 'DELETE', path: `/folders/${gateFolder.id}.json` });
  await sleep(2500);

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
    await sleep(3000);

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
    await sleep(2500);
    await purge();
    let shared = true;
    try {
      await rpc({
        type: 'SHARE_APPLY',
        foreignModel: 'folder',
        foreignId: dFolder.id,
        permissions: [
          { aro: 'User', aro_foreign_key: betty.id, type: 1, is_new: true },
          { aro: 'User', aro_foreign_key: edith.id, type: 1, is_new: true },
        ],
      });
    } catch (err) {
      shared = false;
      R.info(`共享给 disabled 用户被后端拒绝（本身也合理）: ${String(err).slice(0, 120)}`);
    }
    if (shared) {
      assertMails('停用用户不收信（edith 已 disabled，只有 betty 收到）', await settle(1), [
        { to: BETTY, subject: `Ada 与您共享了文件夹 ${dName}` },
      ]);
    }
    await rpc({ type: 'API_CALL', method: 'DELETE', path: `/folders/${dFolder.id}.json` }).catch(() => {});
    await sleep(2000);
  }

  // cleanup: drop the gate-off resource and put the toggles back where we
  // found them, so a repeat run starts from the same state as this one.
  if (gateRes) {
    const gid = (gateRes?.resource ?? gateRes)?.id ?? gateRes?.id;
    if (gid) await rpc({ type: 'API_CALL', method: 'DELETE', path: `/resources/${gid}.json` }).catch(() => {});
  }
  await rpc({
    type: 'API_CALL',
    method: 'POST',
    path: '/settings/emails/notifications.json',
    body: { send_password_create: false, send_folder_create: false, show_secret: false },
  }).catch(() => {});
} catch (err) {
  // Without this, a throw anywhere above (a transient 5xx, the vault re-locking,
  // RESOURCE_SAVE returning {ok:false} so `resourceId` is undefined) would land
  // straight in `finally`, where process.exit() pre-empts the exception: the run
  // would print "10 passed, 0 failed" and exit 0 with a third of the suite never
  // executed. Record it as a failure and re-surface the stack.
  crashed = err;
  R.bad('运行中断，后续断言未执行', String(err?.stack ?? err).slice(0, 500));
} finally {
  const fail = R.finish(SHOT, EXPECTED_ASSERTIONS);
  await ctx.close().catch(() => {});
  if (crashed) console.error(crashed);
  process.exit(fail || crashed ? 1 : 0);
}
