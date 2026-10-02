// Public sign-up, password recovery and the prerelease limits. Real SQLite, the real account/session/HTTP code.
// The mail provider is reached through fetch: only api.resend.com is answered locally, and the link is read out of
// the message it was asked to send, as its recipient would. No mail is sent and no call is placed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Store } from '../lib/store.mjs';
import { Service } from '../lib/service.mjs';
import { PublicAccounts } from '../lib/public-accounts.mjs';
import { checkPrereleaseCall, prereleaseCallsAvailable, signupLimitReason } from '../lib/prerelease.mjs';
import { Phone } from '../lib/phone.mjs';
import { Worker } from '../lib/worker.mjs';
import { hash } from '../lib/security.mjs';
import { createGateway, configuration } from '../server.mjs';

// The start of a UTC day, so that every fixed throttle window (15 minutes, 1 hour, 1 day) begins here.
const NOW = Date.UTC(2026, 9, 2), PUBLIC = 'https://gateway.oathra-signup-check.dev';
const TERMS = PUBLIC + '/terms', PRIVACY = PUBLIC + '/privacy', VERSION = '2026-10-01';
const MAIL_KEY = ['re', 'LocalCheckOnly' + 'c'.repeat(12)].join('_');
const fault = (code, status) => error => { assert.equal(error.code, code); if (status) assert.equal(error.status, status); return true; };
const address = () => randomUUID() + '@oathra-signup-check.dev';
const secret = () => randomBytes(18).toString('base64url');

function setup(extra = {}) {
  let clock = NOW;
  const token = randomBytes(32).toString('hex');
  const users = [{ id: randomUUID(), team: 'local', role: 'admin', tokenHash: hash(token) }];
  const env = { OATHRA_USERS_JSON: JSON.stringify(users), OATHRA_DATA_KEY: randomBytes(32).toString('hex'), OATHRA_DB: ':memory:', OATHRA_DEPLOYMENT: 'managed', OATHRA_CREDITS_PER_CALL: '3',
    OATHRA_PUBLIC_URL: PUBLIC, OATHRA_MAIL_FROM: 'accounts@oathra-signup-check.dev', RESEND_API_KEY: MAIL_KEY, OATHRA_PUBLIC_SIGNUP: 'true',
    OATHRA_TERMS_URL: TERMS, OATHRA_PRIVACY_URL: PRIVACY, OATHRA_TERMS_VERSION: VERSION, OATHRA_PRERELEASE_PAUSED: 'false', ...extra };
  const config = configuration(env), store = new Store(':memory:', env.OATHRA_DATA_KEY, () => clock), service = new Service(store, config), accounts = new PublicAccounts(service, env);
  const mails = [], mail = { down: false };
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.hostname === '127.0.0.1') return real(url, init);
    if (u.href !== 'https://api.resend.com/emails') throw new Error('unexpected outbound request to ' + u.hostname);
    assert.equal(init.method, 'POST'); assert.equal(init.headers.Authorization, 'Bearer ' + MAIL_KEY);
    const message = JSON.parse(init.body), link = /#(signup|reset)=([A-Za-z0-9_-]{43})/.exec(message.text);
    mails.push({ ...message, to: message.to[0], kind: link?.[1], code: link?.[2], idempotencyKey: init.headers['Idempotency-Key'] });
    if (mail.down) return new Response('{"message":"provider detail"}', { status: 500 });
    return new Response(JSON.stringify({ id: 'mail_' + mails.length }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const f = { env, config, store, service, accounts, mails, mail, users, token, admin: users[0],
    advance(ms) { clock += ms; },
    count: table => store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,
    /** The link the recipient would open. */
    async link(kind, email, ip = 'ip-' + randomUUID()) { const before = mails.length; await accounts.request(kind, { email }, ip); assert.equal(mails.length, before + 1); assert.equal(mails.at(-1).kind, kind); return mails.at(-1).code; },
    async register(email = address(), password = secret()) { const code = await f.link('signup', email); const made = await accounts.verifySignup({ code, password, acceptedTerms: true, termsVersion: VERSION }, 'ip-' + randomUUID()); return { email, password, ...made }; },
    apps: [],
    async http() {
      const app = await createGateway(config, { store, env }); f.apps.push(app);
      await new Promise(r => app.server.listen(0, '127.0.0.1', r));
      const base = 'http://127.0.0.1:' + app.server.address().port;
      return async (path, data, headers = {}) => {
        const r = await fetch(base + '/v1' + path, { method: data ? 'POST' : 'GET', headers: { origin: PUBLIC, 'content-type': 'application/json', ...headers }, ...(data ? { body: JSON.stringify(data) } : {}) });
        return { status: r.status, body: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0], header: r.headers.get('set-cookie') };
      };
    },
    async close() { globalThis.fetch = real; for (const app of f.apps) await app.close(); store.close(); } };
  return f;
}
const using = (fn, extra) => async () => { const f = setup(extra); try { await fn(f); } finally { await f.close(); } };

test('a verification link works once, only the newest link works, and it lasts thirty minutes', using(async f => {
  const req = await f.http(), email = address(), password = secret();
  assert.deepEqual((await req('/public/service')).body.registration, { signupEnabled: true, passwordResetEnabled: true, termsUrl: TERMS, privacyUrl: PRIVACY, termsVersion: VERSION, enabled: true, recoveryEnabled: true });
  const asked = await req('/auth/register', { email: email.toUpperCase() });
  assert.equal(asked.status, 202); assert.deepEqual(asked.body, { accepted: true }); assert.equal(asked.cookie, undefined);
  assert.equal(f.mails.length, 1); assert.equal(f.mails[0].to, email); assert.equal(f.mails[0].from, 'accounts@oathra-signup-check.dev');
  assert.ok(f.mails[0].text.includes(PUBLIC + '/#signup=' + f.mails[0].code));
  const first = f.mails[0].code;
  // Asking for a link creates nothing: no identity, no session, no credit.
  assert.equal(f.count('public_users'), 0); assert.equal(f.count('password_accounts'), 0);
  // The link is stored only as a hash and sealed.
  assert.ok(!JSON.stringify(f.store.db.prepare('SELECT * FROM keys').all()).includes(first)); assert.ok(!JSON.stringify(f.store.db.prepare('SELECT * FROM keys').all()).includes(email));
  // Within a minute a second request sends nothing and leaves the first link alone.
  assert.deepEqual((await req('/auth/register', { email })).body, { accepted: true }); assert.equal(f.mails.length, 1);
  f.advance(60_000);
  await req('/auth/register', { email }); assert.equal(f.mails.length, 2);
  const second = f.mails[1].code; assert.notEqual(second, first); assert.notEqual(f.mails[1].idempotencyKey, f.mails[0].idempotencyKey);
  const input = { password, acceptedTerms: true, termsVersion: VERSION };
  const stale = await req('/auth/verify', { ...input, code: first }); assert.equal(stale.status, 410); assert.equal(stale.body.error, 'login_link_expired');
  assert.equal(f.count('public_users'), 0);
  // A reset link is not a signup link, and a link is nothing without consent or a usable password.
  assert.equal((await req('/auth/reset', { code: second, password })).status, 410);
  assert.equal((await req('/auth/verify', { ...input, code: second, password: 'short' })).body.error, 'password_length');
  const made = await req('/auth/verify', { ...input, code: second, role: 'admin', owner: f.admin.id, team: 'local' });
  assert.equal(made.status, 200); assert.deepEqual(made.body, { signedIn: true, expiresInSeconds: 28800 }); assert.match(made.header, /^__Host-oathra_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=28800; Secure$/);
  const boot = await req('/bootstrap', null, { cookie: made.cookie });
  assert.equal(boot.status, 200); assert.match(boot.body.user.id, /^customer_[a-f0-9-]{36}$/); assert.equal(boot.body.user.role, 'operator');
  assert.deepEqual(boot.body.login, { email, passwordLogin: true, emailVerified: true });
  assert.equal(boot.body.credits.available, 0, 'registration grants no credit');
  assert.equal(boot.body.account.termsVersion, VERSION); assert.equal(boot.body.account.termsAcceptedAt, NOW + 60_000); assert.equal(boot.body.account.consentVersion, null);
  // The new identity is its own team, never one named in the request.
  const created = f.config.users.find(u => u.id === boot.body.user.id); assert.equal(created.team, created.id); assert.equal(created.publicSignup, true);
  const used = await req('/auth/verify', { ...input, code: second }); assert.equal(used.status, 410);
  assert.equal(f.count('public_users'), 1); assert.equal(f.count('password_accounts'), 1);
  assert.equal((await req('/auth/login', { email, password })).status, 200);
  // Thirty minutes, then nothing.
  const late = address(); await req('/auth/register', { email: late }); const expiring = f.mails.at(-1).code;
  f.advance(30 * 60_000);
  assert.equal((await req('/auth/verify', { ...input, code: expiring })).status, 410);
  for (const code of [undefined, '', 'x'.repeat(42), 'x'.repeat(44), second + '\n']) assert.equal((await req('/auth/verify', { ...input, code })).status, 410);
  assert.equal(f.count('public_users'), 1);
  // The identity is durable: a new process finds it in the database.
  const config = configuration(f.env), reloaded = new Service(f.store, config);
  assert.ok(reloaded.config.users.some(u => u.id === created.id && u.publicSignup === true && u.tokenHash === created.tokenHash));
}));

test('asking for a link answers the same for a registered and an unregistered address', using(async f => {
  const req = await f.http(), known = (await f.register()).email, unknown = address();
  f.advance(60_000); f.mails.length = 0;
  const strip = m => ({ from: m.from, subject: m.subject, text: m.text.replace(m.code, '<code>'), kind: m.kind });
  for (const path of ['/auth/register', '/auth/forgot']) {
    const a = await req(path, { email: known }), b = await req(path, { email: unknown });
    assert.equal(a.status, 202); assert.deepEqual(a, b, path);
    // Both addresses get the same message through the same provider request, so timing and failures match too.
    const [first, second] = f.mails.splice(0);
    assert.equal(first.to, known); assert.equal(second.to, unknown); assert.deepEqual(strip(first), strip(second));
    assert.match(first.code, /^[A-Za-z0-9_-]{43}$/);
    if (path === '/auth/forgot') {
      // Only the mailbox of a real account holds a link that does anything.
      const password = secret();
      assert.equal((await req('/auth/reset', { code: second.code, password })).status, 410);
      assert.equal((await req('/auth/reset', { code: first.code, password })).status, 200);
    } else {
      // A second sign-up for a registered address ends at the mailbox owner, who is told so; no second identity appears.
      const again = await req('/auth/verify', { code: first.code, password: secret(), acceptedTerms: true, termsVersion: VERSION });
      assert.equal(again.status, 409); assert.equal(again.body.error, 'account_already_registered'); assert.equal(again.cookie, undefined);
    }
  }
  assert.equal(f.count('public_users'), 1); assert.equal(f.count('password_accounts'), 1);
  // A provider failure is reported the same way for both.
  f.advance(3600_000); f.mail.down = true;
  for (const path of ['/auth/register', '/auth/forgot']) {
    const a = await req(path, { email: known }), b = await req(path, { email: unknown });
    assert.equal(a.status, 503); assert.equal(a.body.error, 'email_delivery_unavailable'); assert.equal(b.status, a.status); assert.equal(b.body.error, a.body.error);
    assert.ok(!JSON.stringify(a.body).includes('provider detail'));
  }
  // A password login gives the same answer for a wrong password and an unknown address.
  const wrong = await req('/auth/login', { email: known, password: 'wrong-password' }), nobody = await req('/auth/login', { email: unknown, password: 'wrong-password' });
  assert.equal(wrong.status, 401); assert.equal(nobody.status, 401); assert.equal(wrong.body.error, nobody.body.error);
  // Requests are refused before any work when they are not from the service's own page or carry no address.
  assert.equal((await req('/auth/register', { email: unknown }, { origin: 'https://elsewhere.oathra-signup-check.dev' })).status, 403);
  for (const email of [undefined, '', 'no-at-sign', 'two@@signs.dev', 'a@b', 'line\nbreak@oathra-signup-check.dev', 'x'.repeat(250) + '@a.dev']) assert.equal((await req('/auth/register', { email })).body.error, 'invalid_email');
}));

test('link requests are limited to 3 an hour per address, 20 a quarter-hour per client and 300 a day in all', using(async f => {
  const limited = fault('public_accounts_rate_limited', 429), email = 'limit@oathra-signup-check.dev';
  // Per address: three in the hour window, whatever the client and whichever of the two links.
  for (let i = 0; i < 3; i++) f.accounts.throttle('client-' + i, email);
  assert.throws(() => f.accounts.throttle('client-3', email), limited);
  f.accounts.throttle('client-3', 'other@oathra-signup-check.dev');
  f.advance(3600_000 - 1); assert.throws(() => f.accounts.throttle('client-3', email), limited);
  f.advance(1); f.accounts.throttle('client-3', email);
  // Per client: twenty in the fifteen-minute window.
  for (let i = 0; i < 20; i++) f.accounts.throttle('one-client', i + '@oathra-signup-check.dev');
  assert.throws(() => f.accounts.throttle('one-client', '20@oathra-signup-check.dev'), limited);
  // A refused request is rolled back whole: it has not used up the address's own allowance.
  for (let i = 0; i < 3; i++) f.accounts.throttle('fresh-' + i, '20@oathra-signup-check.dev');
  f.advance(15 * 60_000 - 1); assert.throws(() => f.accounts.throttle('one-client', '21@oathra-signup-check.dev'), limited);
  f.advance(1); f.accounts.throttle('one-client', '21@oathra-signup-check.dev');
  assert.throws(() => f.accounts.throttle(undefined, email), fault('invalid_client_address', 400));
  assert.throws(() => f.accounts.throttle('x'.repeat(129), email), fault('invalid_client_address', 400));
  // The counters are keyed hashes: neither the address nor the client is written down.
  const rows = JSON.stringify(f.store.db.prepare("SELECT key FROM keys WHERE scope='public-auth-rate'").all());
  assert.ok(!rows.includes('oathra-signup-check') && !rows.includes('one-client'));
}));

test('the whole service sends at most 300 link mails a day', using(async f => {
  const limited = fault('public_accounts_rate_limited', 429);
  for (let i = 0; i < 300; i++) f.accounts.throttle('c' + i, i + '@oathra-signup-check.dev');
  assert.throws(() => f.accounts.throttle('c300', '300@oathra-signup-check.dev'), limited);
  // The limit is checked before the provider is asked: nothing is sent, for a new or an existing address.
  await assert.rejects(f.accounts.requestSignup({ email: address() }, 'c301'), limited);
  await assert.rejects(f.accounts.requestReset({ email: address() }, 'c302'), limited);
  assert.equal(f.mails.length, 0);
  f.advance(86400_000 - 1); assert.throws(() => f.accounts.throttle('c303', '303@oathra-signup-check.dev'), limited);
  f.advance(1); f.accounts.throttle('c303', '303@oathra-signup-check.dev');
}));

test('the fourth request for one address in an hour is refused before any mail, and a link allows ten attempts', using(async f => {
  const email = address();
  const code = await f.link('signup', email); f.advance(60_000);
  await f.link('reset', email); f.advance(60_000);
  const latest = await f.link('signup', email); f.advance(60_000);
  await assert.rejects(f.accounts.requestSignup({ email }, 'another-client'), fault('public_accounts_rate_limited', 429));
  await assert.rejects(f.accounts.requestReset({ email }, 'a-third-client'), fault('public_accounts_rate_limited', 429));
  assert.equal(f.mails.length, 3); assert.notEqual(code, latest);
  // Guessing against one link: ten tries in fifteen minutes, counted durably, whatever the client.
  const input = { code: latest, password: 'short', acceptedTerms: true, termsVersion: VERSION };
  for (let i = 0; i < 10; i++) await assert.rejects(f.accounts.verifySignup(input, 'guess-' + i), fault('password_length', 400));
  await assert.rejects(f.accounts.verifySignup({ ...input, password: secret() }, 'guess-10'), fault('login_rate_limited', 429));
  assert.equal(f.count('public_users'), 0);
  assert.ok(f.count("keys WHERE scope='password-rate'") > 0);
}));

test('consent is to the current terms: an older version, or a link issued under other terms, creates nothing', using(async f => {
  const email = address(), password = secret(), code = await f.link('signup', email);
  for (const input of [{ acceptedTerms: false, termsVersion: VERSION }, { termsVersion: VERSION }, { acceptedTerms: 'true', termsVersion: VERSION }, { acceptedTerms: true }, { acceptedTerms: true, termsVersion: '2026-09-01' }])
    await assert.rejects(f.accounts.verifySignup({ code, password, ...input }, 'client'), fault('accept_current_terms', 400));
  // The operator publishes new terms while the link is in the mailbox.
  for (const change of [{ OATHRA_TERMS_VERSION: '2026-11-01' }, { OATHRA_TERMS_URL: PUBLIC + '/terms-v2' }, { OATHRA_PRIVACY_URL: PUBLIC + '/privacy-v2' }]) {
    const next = new PublicAccounts(f.service, { ...f.env, ...change }), termsVersion = next.status().termsVersion;
    // Neither the version the link was issued under nor the new one is accepted through the old link.
    await assert.rejects(next.verifySignup({ code, password, acceptedTerms: true, termsVersion }, 'client-' + termsVersion), fault('terms_changed_request_new_link', 409));
    if (termsVersion !== VERSION) await assert.rejects(next.verifySignup({ code, password, acceptedTerms: true, termsVersion: VERSION }, 'client-old'), fault('accept_current_terms', 400));
  }
  assert.equal(f.count('public_users'), 0); assert.equal(f.count('password_accounts'), 0);
  // The link itself was not burned by the refusals; under the terms it was issued for it still works.
  const made = await f.accounts.verifySignup({ code, password, acceptedTerms: true, termsVersion: VERSION }, 'client-final');
  const account = f.service.account(made.user);
  assert.equal(account.termsVersion, VERSION); assert.equal(account.termsUrl, TERMS); assert.equal(account.privacyUrl, PRIVACY); assert.equal(account.termsAcceptedAt, NOW);
}));

test('two simultaneous verifications of one link create one account', using(async f => {
  const req = await f.http(), email = address(), code = await f.link('signup', email);
  const input = { code, acceptedTerms: true, termsVersion: VERSION };
  const results = await Promise.all([req('/auth/verify', { ...input, password: secret() }), req('/auth/verify', { ...input, password: secret() })]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 410]);
  assert.equal(f.count('public_users'), 1); assert.equal(f.count('password_accounts'), 1);
  assert.equal(f.config.users.filter(u => u.publicSignup).length, 1);
  assert.equal(results.filter(r => r.cookie).length, 1);
  // Directly against the module as well, where both callers have already passed the first check.
  const other = address(), second = await f.link('signup', other);
  const settled = await Promise.allSettled([1, 2].map(n => f.accounts.verifySignup({ code: second, password: secret(), acceptedTerms: true, termsVersion: VERSION }, 'client-' + n)));
  assert.deepEqual(settled.map(s => s.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(settled.find(s => s.status === 'rejected').reason.code, 'login_link_expired');
  assert.equal(f.count('public_users'), 2); assert.equal(f.count('password_accounts'), 2);
}));

test('a password reset signs out every earlier session, works once, and changes only the password', using(async f => {
  const req = await f.http(), email = address(), password = secret(), next = secret();
  await req('/auth/register', { email });
  const first = await req('/auth/verify', { code: f.mails.at(-1).code, password, acceptedTerms: true, termsVersion: VERSION });
  const elsewhere = await req('/auth/login', { email, password });
  for (const session of [first, elsewhere]) assert.equal((await req('/bootstrap', null, { cookie: session.cookie })).status, 200);
  const owner = (await req('/bootstrap', null, { cookie: first.cookie })).body.user.id;
  assert.deepEqual((await req('/auth/forgot', { email })).body, { accepted: true });
  const code = f.mails.at(-1).code; assert.equal(f.mails.at(-1).kind, 'reset');
  // Asking for a reset changes nothing by itself.
  assert.equal((await req('/bootstrap', null, { cookie: first.cookie })).status, 200); assert.equal((await req('/auth/login', { email, password })).status, 200);
  assert.equal((await req('/auth/reset', { code, password: 'short' })).body.error, 'password_length');
  assert.equal((await req('/auth/verify', { code, password: next, acceptedTerms: true, termsVersion: VERSION })).status, 410);
  const reset = await req('/auth/reset', { code, password: next, email: address(), owner: f.admin.id });
  assert.equal(reset.status, 200); assert.ok(reset.cookie);
  for (const session of [first, elsewhere]) assert.equal((await req('/bootstrap', null, { cookie: session.cookie })).status, 401);
  const boot = await req('/bootstrap', null, { cookie: reset.cookie });
  assert.equal(boot.status, 200); assert.equal(boot.body.user.id, owner); assert.equal(boot.body.login.email, email);
  assert.equal((await req('/auth/login', { email, password })).status, 401); assert.equal((await req('/auth/login', { email, password: next })).status, 200);
  assert.equal((await req('/auth/reset', { code, password: secret() })).status, 410);
  assert.equal((await req('/auth/login', { email, password: next })).status, 200);
  assert.equal(f.count('public_users'), 1); assert.equal(f.count('password_accounts'), 1);
  // An older reset link dies with the password it was issued against, even though it was never opened.
  f.advance(60_000); await req('/auth/forgot', { email }); const older = f.mails.at(-1).code;
  const session = await req('/auth/login', { email, password: next });
  assert.equal((await req('/auth/password', { currentPassword: next, newPassword: secret() }, { cookie: session.cookie })).status, 200);
  assert.equal((await req('/auth/reset', { code: older, password: secret() })).status, 410);
}));

test('an address an administrator enrolled is mailed like any other, but its link resets nothing', using(async f => {
  const email = address(), password = secret();
  await f.service.passwords.enroll({ code: new URL(f.service.passwords.issue(f.admin.id).url).hash.slice(7), email, password }, 'console');
  const code = await f.link('reset', email);
  await assert.rejects(f.accounts.reset({ code, password: secret() }, 'client'), fault('login_link_expired', 410));
  assert.equal((await f.service.passwords.authenticate({ email, password }, 'client')).user.id, f.admin.id);
}));

test('terms and privacy links must be public https pages', using(f => {
  const urls = env => { const s = new PublicAccounts(f.service, { ...f.env, ...env }).status(); return s; };
  for (const good of [TERMS, 'https://oathra-signup-check.dev/', 'https://docs.oathra-signup-check.dev/legal/terms.html', 'https://例え.jp/terms']) {
    const s = urls({ OATHRA_TERMS_URL: good, OATHRA_PRIVACY_URL: good });
    assert.equal(s.termsUrl, new URL(good).href); assert.equal(s.privacyUrl, new URL(good).href); assert.equal(s.signupEnabled, true);
  }
  const refused = ['http://oathra-signup-check.dev/terms', 'HTTP://oathra-signup-check.dev/terms', 'ftp://oathra-signup-check.dev/terms', 'javascript:alert(1)//oathra-signup-check.dev', 'data:text/html,terms', 'file:///etc/terms.html', '//oathra-signup-check.dev/terms', 'oathra-signup-check.dev/terms', '/terms', '',
    'https://203.0.113.7/terms', 'https://127.0.0.1/terms', 'https://2130706433/terms', 'https://0x7f.0.0.1/terms', 'https://[::1]/terms', 'https://[2001:db8::1]/terms', 'https://[::ffff:203.0.113.7]/terms',
    'https://printer.local/terms', 'https://gateway.test/terms', 'https://gateway.TEST/terms', 'https://localhost/terms', 'https://app.localhost/terms', 'https://localhost.oathra-signup-check.dev/terms', 'https://intranet/terms', 'https://wiki.internal/terms', 'https://site.invalid/terms', 'https://site.example/terms', 'https://random-words.trycloudflare.com/terms',
    'https://reader:secret@oathra-signup-check.dev/terms', 'https://oathra-signup-check.dev:8443/terms', 'https://oathra-signup-check.dev/terms?version=1', 'https://oathra-signup-check.dev/terms#section', 'https://oathra-signup-check.dev/' + 'x'.repeat(2048), undefined, 42];
  for (const bad of refused) for (const name of ['OATHRA_TERMS_URL', 'OATHRA_PRIVACY_URL']) {
    const s = urls({ [name]: bad }), field = name === 'OATHRA_TERMS_URL' ? 'termsUrl' : 'privacyUrl';
    assert.equal(s[field], null, name + ' accepted ' + bad);
    // Without both documents nobody can be asked to agree, so sign-up is closed; recovery is not affected.
    assert.equal(s.signupEnabled, false, 'sign-up stayed open with ' + bad); assert.equal(s.passwordResetEnabled, true);
  }
}));

test('a terms link written as a fully qualified name with a trailing dot is held to the same rule', using(f => {
  for (const bad of ['https://printer.local./terms', 'https://gateway.test./terms', 'https://app.localhost./terms', 'https://wiki.internal./terms'])
    assert.equal(new PublicAccounts(f.service, { ...f.env, OATHRA_TERMS_URL: bad }).status().termsUrl, null, 'accepted ' + bad);
}));

test('sign-up and recovery are closed unless the deployment, sender, mail key and public address are all in place', using(async f => {
  const closed = fault('public_accounts_unavailable', 503);
  const variant = (env, change = {}) => { const service = new Service(f.store, { ...f.config, ...change }); return new PublicAccounts(service, { ...f.env, ...env }); };
  for (const a of [variant({ RESEND_API_KEY: undefined }), variant({ RESEND_API_KEY: 'not a key' }), variant({ OATHRA_MAIL_FROM: undefined }), variant({ OATHRA_MAIL_FROM: 'Oathra <accounts@oathra-signup-check.dev>' }),
    variant({ OATHRA_MAIL_FROM: 'accounts@oathra-signup-check.dev\r\nBcc: someone@oathra-signup-check.dev' }), variant({ OATHRA_MAIL_FROM: 'a@oathra-signup-check.dev,b@oathra-signup-check.dev' }),
    variant({}, { deployment: 'self-hosted' }), variant({}, { publicUrl: 'http://localhost:4244' }), variant({}, { publicUrl: 'https://gateway.test' }), variant({}, { publicUrl: 'https://203.0.113.7' }), variant({}, { publicUrl: 'https://words.trycloudflare.com' })]) {
    assert.deepEqual([a.status().signupEnabled, a.status().passwordResetEnabled], [false, false]);
    await assert.rejects(a.requestSignup({ email: address() }, 'client'), closed); await assert.rejects(a.requestReset({ email: address() }, 'client'), closed);
    await assert.rejects(a.verifySignup({ code: 'x'.repeat(43) }, 'client'), closed); await assert.rejects(a.reset({ code: 'x'.repeat(43) }, 'client'), closed);
  }
  // Recovery without public sign-up is a valid configuration; sign-up without a terms version is not.
  for (const a of [variant({ OATHRA_PUBLIC_SIGNUP: undefined }), variant({ OATHRA_PUBLIC_SIGNUP: 'TRUE' }), variant({ OATHRA_TERMS_VERSION: undefined }), variant({ OATHRA_TERMS_VERSION: 'version one' })]) {
    assert.deepEqual([a.status().signupEnabled, a.status().passwordResetEnabled], [false, true]);
    await assert.rejects(a.requestSignup({ email: address() }, 'client'), closed);
  }
  assert.equal(f.mails.length, 0);
}));

test('the prerelease account cap closes sign-up at the coded number, for requests and for links already sent', using(async f => {
  assert.equal(f.config.prerelease.maxAccounts, 2);
  assert.equal(signupLimitReason(f.store, f.config), null);
  const waiting = [address(), address()], links = [];
  for (const email of waiting) links.push(await f.link('signup', email));
  await f.register(); assert.equal(signupLimitReason(f.store, f.config), null); assert.equal(f.accounts.status().signupEnabled, true);
  await f.register();
  assert.equal(signupLimitReason(f.store, f.config), 'prerelease_capacity_reached');
  assert.deepEqual([f.accounts.status().signupEnabled, f.accounts.status().reason, f.accounts.status().passwordResetEnabled], [false, 'prerelease_capacity_reached', true]);
  const before = f.mails.length;
  await assert.rejects(f.accounts.requestSignup({ email: address() }, 'client'), fault('prerelease_capacity_reached', 503));
  for (const code of links) await assert.rejects(f.accounts.verifySignup({ code, password: secret(), acceptedTerms: true, termsVersion: VERSION }, 'client-' + code.slice(0, 6)), fault('prerelease_capacity_reached', 503));
  assert.equal(f.mails.length, before); assert.equal(f.count('public_users'), 2);
  // Operator-configured accounts do not count against the cap; a cap of zero admits nobody; no prerelease, no cap.
  assert.equal(signupLimitReason(f.store, { prerelease: { ...f.config.prerelease, maxAccounts: 3 } }), null);
  assert.equal(signupLimitReason(f.store, { prerelease: { ...f.config.prerelease, maxAccounts: 0 } }), 'prerelease_capacity_reached');
  assert.equal(signupLimitReason(f.store, { prerelease: { enabled: false } }), null); assert.equal(signupLimitReason(f.store, {}), null);
  // Paused outranks capacity, and existing people can still recover a password.
  f.config.prerelease.paused = true;
  assert.equal(signupLimitReason(f.store, f.config), 'prerelease_paused');
  await assert.rejects(f.accounts.requestSignup({ email: address() }, 'client'), fault('prerelease_paused', 503));
}, { OATHRA_PRERELEASE_MAX_ACCOUNTS: '2' }));

test('two links racing for the last prerelease place create one account', using(async f => {
  const links = [await f.link('signup', address()), await f.link('signup', address())];
  const settled = await Promise.allSettled(links.map((code, n) => f.accounts.verifySignup({ code, password: secret(), acceptedTerms: true, termsVersion: VERSION }, 'client-' + n)));
  assert.deepEqual(settled.map(s => s.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(settled.find(s => s.status === 'rejected').reason.code, 'prerelease_capacity_reached');
  assert.equal(f.count('public_users'), 1); assert.equal(f.config.users.filter(u => u.publicSignup).length, 1);
}, { OATHRA_PRERELEASE_MAX_ACCOUNTS: '1' }));

// ---- Prerelease call limits -------------------------------------------------------------------------------------

const operators = JSON.stringify([{ id: 'alice', team: 'one', role: 'admin', tokenHash: hash('alice-token') }, { id: 'bob', team: 'two', role: 'operator', tokenHash: hash('bob-token') }]);
const prereleaseEnv = (extra = {}) => ({ OATHRA_USERS_JSON: operators, OATHRA_RELEASE_STAGE: 'prerelease', OATHRA_PRERELEASE_PAUSED: 'false', OATHRA_PRERELEASE_DAILY_CALLS: '3', OATHRA_PRERELEASE_GLOBAL_DAILY_CALLS: '5',
  OATHRA_PRERELEASE_GLOBAL_DAILY_USD: '2', OATHRA_DAILY_USD: '1', OATHRA_MAX_CALL_USD: '1', ...extra });
function ledger(extra = {}) {
  let clock = NOW;
  const config = configuration(prereleaseEnv(extra)), store = new Store(':memory:', randomBytes(32).toString('hex'), () => clock);
  const reserve = (owner, usd = 0.25, age = 0) => store.put('reservation', { id: randomUUID(), owner, approvedAt: clock - age, estimatedMaximumUsd: usd });
  const call = (owner = 'alice', usd = 0.25, more = {}) => ({ id: randomUUID(), owner, maxSeconds: 120, maxUsd: 1, estimatedMaximumUsd: usd, ...more });
  const check = (mission = call(), p = {}) => checkPrereleaseCall(store, { ...config, prerelease: { ...config.prerelease, ...p } }, mission);
  return { config, store, reserve, call, check, advance(ms) { clock += ms; }, close() { store.close(); } };
}
const withLedger = (fn, extra) => () => { const l = ledger(extra); try { fn(l); } finally { l.close(); } };

test('prerelease configuration: off unless asked for, paused unless explicitly resumed, zero budget until one is allocated', () => {
  assert.deepEqual(configuration({ OATHRA_USERS_JSON: operators }).prerelease, { enabled: false });
  assert.deepEqual(configuration({ OATHRA_USERS_JSON: operators, OATHRA_PUBLIC_SIGNUP: 'true', OATHRA_RELEASE_STAGE: 'standard' }).prerelease, { enabled: false });
  // Opening public sign-up turns the limits on by itself, and starts paused with no money to spend.
  const defaults = configuration({ OATHRA_USERS_JSON: operators, OATHRA_PUBLIC_SIGNUP: 'true' });
  assert.deepEqual(defaults.prerelease, { enabled: true, paused: true, inboundEnabled: false, maxAccounts: 10, dailyCallsPerAccount: 3, globalDailyCalls: 20, maxCallSeconds: 180, maxCallUsd: 10, dailyUsdPerAccount: 30, globalDailyUsd: 0 });
  assert.equal(defaults.maxSeconds, 180); assert.equal(prereleaseCallsAvailable(defaults), false);
  for (const paused of [undefined, 'true']) assert.equal(configuration(prereleaseEnv({ OATHRA_PRERELEASE_PAUSED: paused })).prerelease.paused, true);
  const open = configuration(prereleaseEnv());
  assert.equal(open.prerelease.paused, false); assert.equal(prereleaseCallsAvailable(open), true);
  assert.equal(prereleaseCallsAvailable(configuration({ OATHRA_USERS_JSON: operators })), true);
  // The stricter of the ordinary and the prerelease limit applies; the ordinary "0 = unlimited" never widens it.
  assert.equal(configuration(prereleaseEnv({ OATHRA_DAILY_CALLS: '2' })).prerelease.dailyCallsPerAccount, 2);
  assert.equal(configuration(prereleaseEnv({ OATHRA_DAILY_CALLS: '0' })).prerelease.dailyCallsPerAccount, 3);
  assert.equal(configuration(prereleaseEnv({ OATHRA_DAILY_USD: '0' })).prerelease.dailyUsdPerAccount, 2);
  assert.equal(configuration(prereleaseEnv({ OATHRA_MAX_SECONDS: '120' })).prerelease.maxCallSeconds, 120);
  assert.equal(configuration(prereleaseEnv({ OATHRA_MAX_SECONDS: '600', OATHRA_PRERELEASE_MAX_SECONDS: '240' })).maxSeconds, 240);
  for (const [name, values] of Object.entries({ OATHRA_PRERELEASE_DAILY_CALLS: ['0'], OATHRA_PRERELEASE_GLOBAL_DAILY_CALLS: ['0'], OATHRA_PRERELEASE_GLOBAL_DAILY_USD: ['0'] }))
    for (const value of values) assert.equal(prereleaseCallsAvailable(configuration(prereleaseEnv({ [name]: value }))), false, name);
  for (const bad of [{ OATHRA_RELEASE_STAGE: 'beta' }, { OATHRA_PRERELEASE_PAUSED: 'no' }, { OATHRA_PRERELEASE_PAUSED: '' }, { OATHRA_PRERELEASE_DAILY_CALLS: '-1' }, { OATHRA_PRERELEASE_DAILY_CALLS: '1.5' }, { OATHRA_PRERELEASE_DAILY_CALLS: '501' },
    { OATHRA_PRERELEASE_GLOBAL_DAILY_CALLS: '10001' }, { OATHRA_PRERELEASE_GLOBAL_DAILY_USD: '1001' }, { OATHRA_PRERELEASE_GLOBAL_DAILY_USD: 'lots' }, { OATHRA_PRERELEASE_MAX_ACCOUNTS: '1001' }, { OATHRA_PRERELEASE_MAX_SECONDS: '29' }])
    assert.throws(() => configuration(prereleaseEnv(bad)), error => error.status === 500 && /^invalid_/.test(error.code), JSON.stringify(bad));
});

test('prerelease: paused refuses every new call; inbound and calls beyond the reviewed limits are refused', withLedger(l => {
  l.check();
  assert.throws(() => l.check(l.call(), { paused: true }), fault('prerelease_paused', 503));
  l.check(l.call('alice', 0));
  assert.throws(() => l.check(l.call('alice', 0.25, { direction: 'inbound' })), fault('prerelease_inbound_disabled', 403));
  for (const more of [{ maxSeconds: 181 }, { maxSeconds: 0 }, { maxSeconds: NaN }, { maxUsd: 1.01 }, { maxUsd: 0 }, { estimatedMaximumUsd: 1.01 }, { estimatedMaximumUsd: -0.01 }, { estimatedMaximumUsd: undefined }])
    assert.throws(() => l.check(l.call('alice', 0.25, more)), fault('prerelease_limits_changed_review_again', 409), JSON.stringify(more));
  l.check(l.call('alice', 1, { maxSeconds: 180, maxUsd: 1 }));
  // Without the prerelease stage none of this applies.
  checkPrereleaseCall(l.store, { prerelease: { enabled: false } }, l.call('alice', 99, { direction: 'inbound' })); checkPrereleaseCall(l.store, {}, l.call());
}));

test('prerelease: call counts stop at the exact number, per account and across all accounts', withLedger(l => {
  // Per account: 3. The third call is allowed, the fourth is not; another account is unaffected.
  l.reserve('alice', 0.01); l.reserve('alice', 0.01); l.check();
  l.reserve('alice', 0.01);
  assert.throws(() => l.check(), fault('prerelease_call_limit', 429));
  l.check(l.call('bob'));
  // Across accounts: 5. With four on the ledger one more is allowed, with five none, whoever asks.
  l.reserve('bob', 0.01); l.check(l.call('bob'));
  l.reserve('carol', 0.01);
  assert.throws(() => l.check(l.call('bob')), fault('prerelease_global_call_limit', 429));
  assert.throws(() => l.check(l.call('dave')), fault('prerelease_global_call_limit', 429));
  // A retry of a call that already holds its reservation is not counted against itself.
  const held = l.reserve('bob', 0.01); l.store.remove('reservation', l.store.all('reservation', 'carol')[0].id);
  l.check(l.call('bob', 0.25, { id: held.id }));
  assert.throws(() => l.check(l.call('bob')), fault('prerelease_global_call_limit', 429));
}));

test('prerelease: spending stops at the exact amount, per account and across all accounts', withLedger(l => {
  // Per account: 1 USD. 0.75 on the ledger: 0.25 more is exactly the limit and allowed; 0.26 is not.
  l.reserve('alice', 0.5); l.reserve('alice', 0.25);
  l.check(l.call('alice', 0.25));
  assert.throws(() => l.check(l.call('alice', 0.26)), fault('prerelease_budget_limit', 429));
  l.check(l.call('bob', 1));
  // Across accounts: 2 USD. 1.5 on the ledger: 0.5 more is exactly the limit; anything above is refused for everyone.
  l.reserve('bob', 0.75);
  l.check(l.call('bob', 0.25)); l.check(l.call('carol', 0.5));
  assert.throws(() => l.check(l.call('carol', 0.51)), fault('prerelease_global_budget_limit', 429));
  l.reserve('carol', 0.5);
  assert.throws(() => l.check(l.call('dave', 0.01)), fault('prerelease_global_budget_limit', 429));
  l.check(l.call('dave', 0));
}));

test('prerelease: a budget that is reached exactly in ordinary decimal amounts is still within the limit', withLedger(l => {
  l.reserve('alice', 0.4); l.reserve('alice', 0.4);
  l.check(l.call('alice', 0.4), { dailyUsdPerAccount: 1.2, globalDailyUsd: 100 });
  l.check(l.call('bob', 0.4), { dailyUsdPerAccount: 100, globalDailyUsd: 1.2 });
}));

test('prerelease: a limit of zero refuses, it never means unlimited', withLedger(l => {
  l.check(l.call('alice', 0));
  assert.throws(() => l.check(l.call('alice', 0), { dailyCallsPerAccount: 0 }), fault('prerelease_call_limit', 429));
  assert.throws(() => l.check(l.call('alice', 0), { globalDailyCalls: 0 }), fault('prerelease_global_call_limit', 429));
  assert.throws(() => l.check(l.call('alice', 0), { dailyUsdPerAccount: 0 }), fault('prerelease_budget_limit', 429));
  assert.throws(() => l.check(l.call('alice', 0), { globalDailyUsd: 0 }), fault('prerelease_global_budget_limit', 429));
  // As configured from the environment, including the default with no budget allocated.
  for (const env of [{ OATHRA_PRERELEASE_DAILY_CALLS: '0' }, { OATHRA_PRERELEASE_GLOBAL_DAILY_CALLS: '0' }, { OATHRA_PRERELEASE_GLOBAL_DAILY_USD: '0' }, { OATHRA_PRERELEASE_GLOBAL_DAILY_USD: undefined }, { OATHRA_DAILY_USD: '0', OATHRA_PRERELEASE_GLOBAL_DAILY_USD: '0' }])
    assert.throws(() => checkPrereleaseCall(l.store, configuration(prereleaseEnv(env)), l.call('alice', 0)), error => error.status === 429 && /^prerelease_(global_)?(call|budget)_limit$/.test(error.code), JSON.stringify(env));
}));

test('prerelease: the window is the last 24 hours, to the millisecond', withLedger(l => {
  const day = 86400_000;
  // Exactly 24 hours old is outside the window; one millisecond younger is inside.
  for (let i = 0; i < 3; i++) l.reserve('alice', 0.3, day);
  l.check(l.call('alice', 0.25));
  l.reserve('alice', 0.3, day - 1); l.reserve('alice', 0.3, day - 1); l.reserve('alice', 0.3, day - 1);
  assert.throws(() => l.check(l.call('alice', 0.01)), fault('prerelease_call_limit', 429));
  assert.throws(() => l.check(l.call('alice', 0.11), { dailyCallsPerAccount: 10 }), fault('prerelease_budget_limit', 429));
  l.check(l.call('alice', 0.1), { dailyCallsPerAccount: 10, globalDailyCalls: 10 });
  // It rolls: a millisecond later those three have left it. It is not a calendar day and not 23 or 25 hours.
  l.advance(1);
  l.check(l.call('alice', 0.25));
  const fresh = ledger();
  try {
    for (let i = 0; i < 5; i++) fresh.reserve('bob', 0.4);
    assert.throws(() => fresh.check(l.call('carol', 0.01)), fault('prerelease_global_call_limit', 429));
    fresh.advance(day - 1); assert.throws(() => fresh.check(l.call('carol', 0.01)), fault('prerelease_global_call_limit', 429));
    fresh.advance(1); fresh.check(l.call('carol', 1));
  } finally { fresh.close(); }
}));

function calls(extra = {}) {
  let clock = NOW;
  const config = configuration(prereleaseEnv({ OATHRA_DAILY_USD: '30', ...extra })), store = new Store(':memory:', randomBytes(32).toString('hex'), () => clock), service = new Service(store, config), u = config.users[0];
  service.saveConsent(u, config.consentVersion); store.put('account', { ...service.account(u), verifiedPhone: '+15005550006', phoneVerificationProvider: 'simulator' });
  const product = service.product(u, { name: 'Example product', facts: 'Only the reviewed feature.', reviewed: true });
  let n = 0;
  const draft = () => { const contact = service.contact(u, { name: '田中さん', phone: '+8190000000' + String(10 + n++), relationship: 'inquiry', basis: 'Customer requested a follow-up' }); return service.prepare(u, { request: '田中さんに商談を提案', contactId: contact.id, productId: product.id }); };
  const approve = m => service.start(u, service.review(u, m.id).approvalToken, 'key-' + m.id, true);
  return { config, store, service, u, draft, approve, close() { store.close(); } };
}

test('prerelease limits sit on the real approval path: paused starts nothing, the per-account count holds, a worker re-checks', async () => {
  const f = calls({ OATHRA_PRERELEASE_DAILY_CALLS: '2' });
  try {
    const first = f.draft();
    assert.ok(first.maxSeconds <= 180, 'a draft is prepared within the prerelease call length');
    f.config.prerelease.paused = true;
    assert.throws(() => f.approve(first), fault('prerelease_paused', 503));
    assert.equal(f.store.get('mission', first.id).status, 'DRAFT'); assert.equal(f.store.all('reservation', f.u.id).length, 0);
    f.config.prerelease.paused = false;
    assert.equal(f.approve(first).status, 'QUEUED');
    // Pausing after approval: the queued call is not placed.
    f.config.prerelease.paused = true;
    let placed = 0; const worker = new Worker(f.service, { process: async () => {}, send: async () => {} }, async () => { placed++; return {}; });
    await worker.tick(); await worker.active?.promise;
    assert.equal(placed, 0); assert.equal(f.store.get('mission', first.id).status, 'FAILED');
    f.config.prerelease.paused = false;
    // The refused call still used one of the day's two places; the third approval is over the limit.
    assert.equal(f.approve(f.draft()).status, 'QUEUED');
    const third = f.draft();
    assert.throws(() => f.approve(third), fault('prerelease_call_limit', 429));
    assert.equal(f.store.get('mission', third.id).status, 'DRAFT'); assert.equal(f.store.all('reservation', f.u.id).length, 2);
  } finally { f.close(); }
});

test('prerelease: an incoming call is rejected before it is answered, recorded or charged', () => {
  const account = 'AC' + 'a'.repeat(32), auth = 'local-signing-value', f = calls({ OATHRA_PUBLIC_URL: 'https://gateway.oathra-signup-check.dev', OATHRA_INBOUND_OWNER: 'alice', OATHRA_INBOUND_NAME: '堀尾' });
  try {
    const phone = new Phone(f.service, { TWILIO_ACCOUNT_SID: account, TWILIO_AUTH_TOKEN: auth });
    const ring = () => { const path = '/hooks/twilio/voice', params = { AccountSid: account, CallSid: 'CA' + randomBytes(16).toString('hex'), From: '+819011112222', To: '+815000000000', CallStatus: 'ringing' };
      return phone.callback(path, params, { 'x-twilio-signature': createHmac('sha1', auth).update(f.config.publicUrl + path + Object.keys(params).sort().map(k => k + params[k]).join('')).digest('base64') }); };
    assert.equal(f.config.prerelease.inboundEnabled, false);
    const audits = () => f.store.audits({ limit: 500 }).filter(a => a.action.startsWith('call.inbound')).length;
    assert.equal(ring(), '<Response><Reject reason="rejected"/></Response>');
    assert.equal(f.store.list('mission').length, 0); assert.equal(audits(), 0); assert.deepEqual({ ...f.service.credits.balance('alice') }, { available: 0, held: 0 });
    // Paused or not makes no difference; only leaving the prerelease stage lets the ordinary inbound logic run.
    f.config.prerelease.paused = true; assert.equal(ring(), '<Response><Reject reason="rejected"/></Response>');
    f.config.prerelease = { enabled: false };
    const ordinary = ring(); assert.ok(!ordinary.includes('<Reject')); assert.ok(ordinary.includes('<Say')); assert.equal(audits(), 1);
    // A request that is not from the carrier never reaches either answer.
    f.config.prerelease = { enabled: true, paused: false };
    assert.throws(() => phone.callback('/hooks/twilio/voice', { AccountSid: account }, { 'x-twilio-signature': 'AAAA' }), /invalid_twilio_signature/);
  } finally { f.close(); }
});
