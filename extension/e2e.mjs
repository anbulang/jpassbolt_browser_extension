// End-to-end check of the extension's BACKGROUND data path against a live
// JPassbolt backend. It replicates background/index.ts (GpgAuth 3-stage ->
// list resources -> decrypt a secret) using the same OpenPGP calls, proving the
// core works against the running server. Run: `node e2e.mjs` from extension/.
import * as openpgp from 'openpgp';
import { readFileSync } from 'node:fs';

const BASE = process.env.JPB_BASE || 'http://localhost:8080/api';
const KEY_PATH = process.env.JPB_KEY ||
  '/Users/chaucer/Code/gitlab/jpassbolt/jpassbolt_api/src/main/resources/gpg/server_private.asc';
const PASS = process.env.JPB_PASS || 'password';

const log = (...a) => console.log(...a);
const ok = (m) => log('  ✓', m);
const fail = (m) => { log('  ✗', m); process.exitCode = 1; };

async function main() {
  log('== JPassbolt extension E2E (background data path) ==');
  log('server:', BASE);

  // 0. unlock key (as background.unlock does)
  const armored = readFileSync(KEY_PATH, 'utf8');
  let key = await openpgp.readPrivateKey({ armoredKey: armored });
  if (key.isDecrypted()) return fail('dev key is not passphrase-protected (unexpected)');
  key = await openpgp.decryptKey({ privateKey: key, passphrase: PASS });
  const fingerprint = key.getFingerprint();
  ok('private key unlocked, fingerprint ' + fingerprint);

  // 1. GpgAuth stage 1
  const s1 = await fetch(BASE + '/auth/login.json', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { gpg_auth: { keyid: fingerprint } } }),
  });
  const enc = s1.headers.get('x-gpgauth-user-auth-token');
  if (!enc) return fail('stage1: no X-GPGAuth-User-Auth-Token header (status ' + s1.status + ')');
  ok('stage1: challenge token received');

  // decrypt challenge (PHP urlencode: + -> space, real + as %2B)
  const armoredMsg = decodeURIComponent(enc.replace(/\+/g, ' '));
  const message = await openpgp.readMessage({ armoredMessage: armoredMsg });
  const { data: nonce } = await openpgp.decrypt({ message, decryptionKeys: key });
  ok('stage1: challenge decrypted (nonce len ' + String(nonce).length + ')');

  // 2. GpgAuth stage 2 -> JWT
  const s2 = await fetch(BASE + '/auth/login.json', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { gpg_auth: { keyid: fingerprint, user_token_result: nonce } } }),
  });
  const auth = s2.headers.get('authorization');
  if (!auth || !auth.startsWith('Bearer ')) return fail('stage2: no Bearer JWT (status ' + s2.status + ')');
  const jwt = auth.slice(7);
  ok('stage2: JWT issued (' + jwt.slice(0, 24) + '...)');

  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt };

  // 3. who am I
  const me = await (await fetch(BASE + '/users/me.json', { headers: H })).json();
  ok('me: ' + me.body?.username + ' (' + (me.body?.profile ? me.body.profile.first_name + ' ' + me.body.profile.last_name : '?') + ')');

  // 4. list resources
  let list = await (await fetch(BASE + '/resources.json', { headers: H })).json();
  let items = list.body || [];
  ok('resources: ' + items.length + ' item(s)');

  // 4b. if the vault is empty, create one (encrypt-to-self) to exercise the
  //     full encrypt -> store -> list -> decrypt round-trip.
  if (items.length === 0) {
    const types = (await (await fetch(BASE + '/resource-types.json', { headers: H })).json()).body || [];
    const t = types.find((x) => x.slug === 'password-string') || types.find((x) => x.slug && x.slug.startsWith('password')) || types[0];
    if (!t) return fail('no resource types available to create a test resource');
    const pub = key.toPublic();
    const armoredSecret = await openpgp.encrypt({
      message: await openpgp.createMessage({ text: 'e2e-secret-pw-' + fingerprint.slice(0, 6) }),
      encryptionKeys: pub,
    });
    const created = await (await fetch(BASE + '/resources.json', {
      method: 'POST', headers: H,
      body: JSON.stringify({
        name: 'E2E Test Login', username: 'ada@example.com', uri: 'https://example.com',
        resource_type_id: t.id, secrets: [{ data: armoredSecret }],
      }),
    })).json();
    if (created.header?.status !== 'success') return fail('create failed: ' + (created.header?.message || JSON.stringify(created).slice(0, 120)));
    ok('created test resource (type ' + t.slug + ', id ' + (created.body?.id || '?') + ')');
    list = await (await fetch(BASE + '/resources.json', { headers: H })).json();
    items = list.body || [];
    ok('resources after create: ' + items.length + ' item(s)');
  }
  for (const r of items.slice(0, 5)) log('     -', r.name || '(encrypted)', '| user:', r.username || '-', '| uri:', r.uri || '-');

  // 5. decrypt the first resource's secret
  if (items.length) {
    const id = items[0].id;
    const sec = await (await fetch(BASE + '/secrets/resource/' + id + '.json', { headers: H })).json();
    if (!sec.body?.data) return fail('no secret returned for ' + id);
    const msg = await openpgp.readMessage({ armoredMessage: sec.body.data });
    const { data: clear } = await openpgp.decrypt({ message: msg, decryptionKeys: key });
    const text = typeof clear === 'string' ? clear : await new Response(clear).text();
    ok('secret decrypted for "' + (items[0].name || id) + '": ' + text.length + ' chars, starts "' + text.slice(0, 3) + '…"');
  }

  log(process.exitCode ? '\n== FAIL ==' : '\n== ALL GREEN: GpgAuth + list + decrypt work end-to-end ==');
}

main().catch((e) => { fail('exception: ' + (e?.message || e)); log('\n== FAIL =='); });
