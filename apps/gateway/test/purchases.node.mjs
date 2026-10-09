// Credit purchases. Real SQLite, the real Purchases/Service/Credits code and the real HTTP routes.
// Stripe is reached through fetch: only api.stripe.com is answered by a local stand-in that keeps Stripe's
// own state (prices, sessions, payment intents, charges, idempotency keys). Webhook signatures are computed
// for real over the raw bytes. Nothing leaves this machine and no payment is made.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../lib/store.mjs';
import { Service } from '../lib/service.mjs';
import { Purchases, stripeSignatureValid, STRIPE_API_VERSION } from '../lib/purchases.mjs';
import { simulate } from '../lib/worker.mjs';
import { hash } from '../lib/security.mjs';
import { createGateway, configuration } from '../server.mjs';

const NOW = Date.UTC(2026, 9, 2, 3, 0, 0), PUBLIC = 'https://gateway.oathra-purchase-check.dev';
// Assembled at run time so that no credential-shaped literal sits in the repository. Neither value exists at Stripe.
const SECRET = ['sk', 'live', 'LocalCheckOnly' + 'a'.repeat(12)].join('_'), WHSEC = ['whsec', 'LocalCheckOnly' + 'b'.repeat(12)].join('_');
const PACKS = [{ id: 'starter', priceId: 'price_1Starter', credits: 3, name: 'スターター' }, { id: 'large', priceId: 'price_1Large', credits: 30 }];
const STARTER = { packId: 'starter', amount: 500, currency: 'jpy', credits: 3 }, LARGE = { packId: 'large', amount: 4000, currency: 'jpy', credits: 30 };
const fault = (code, status) => error => { assert.equal(error.code, code); if (status) assert.equal(error.status, status); return true; };
const hex = n => randomBytes(n).toString('hex');

/** Stripe's side of the conversation: what it would hold, and what it would answer. */
function fakeStripe() {
  const price = (id, unit_amount) => ({ id, object: 'price', active: true, livemode: true, type: 'one_time', billing_scheme: 'per_unit', unit_amount, currency: 'jpy',
    custom_unit_amount: null, transform_quantity: null, recurring: null, tiers_mode: null, product: { id: 'prod_' + id.slice(6), object: 'product', active: true, livemode: true } });
  const s = { prices: new Map([['price_1Starter', price('price_1Starter', 500)], ['price_1Large', price('price_1Large', 4000)]]),
    sessions: new Map(), lines: new Map(), intents: new Map(), charges: new Map(), keys: new Map(), requests: [], failure: null };
  const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
  /** The session as an event carries it (no expansions), or as the gateway reads it back (line items, intent and charge expanded). */
  s.view = (id, expanded = false) => {
    const session = structuredClone(s.sessions.get(id));
    if (!expanded) return session;
    const intent = session.payment_intent ? structuredClone(s.intents.get(session.payment_intent)) : null;
    if (intent) intent.latest_charge = structuredClone(s.charges.get(intent.latest_charge));
    return { ...session, payment_intent: intent, line_items: { object: 'list', has_more: false, data: [structuredClone(s.lines.get(id))] } };
  };
  s.pay = id => {
    const session = s.sessions.get(id), pi = 'pi_' + hex(10), ch = 'ch_' + hex(10);
    s.charges.set(ch, { id: ch, object: 'charge', livemode: true, payment_intent: pi, paid: true, captured: true, status: 'succeeded', amount: session.amount_total, currency: session.currency, refunded: false, amount_refunded: 0, disputed: false });
    s.intents.set(pi, { id: pi, object: 'payment_intent', status: 'succeeded', livemode: true, amount: session.amount_total, amount_received: session.amount_total, currency: session.currency, metadata: { ...session.metadata }, latest_charge: ch });
    Object.assign(session, { status: 'complete', payment_status: 'paid', payment_intent: pi, url: null });
    return { pi, ch };
  };
  s.creates = () => s.requests.filter(r => r.method === 'POST' && r.path === 'checkout/sessions');
  s.fetch = async (url, init = {}) => {
    const u = new URL(String(url)), path = u.pathname.slice(4), method = init.method ?? 'GET', key = init.headers?.['Idempotency-Key'];
    assert.equal(init.headers.Authorization, 'Bearer ' + SECRET); assert.equal(init.headers['Stripe-Version'], STRIPE_API_VERSION);
    s.requests.push({ method, path, key });
    if (s.failure === 'status') return new Response('{"error":{"message":"sk_ detail that must never be shown"}}', { status: 500 });
    if (method === 'GET' && path.startsWith('prices/')) { assert.equal(u.searchParams.get('expand[]'), 'product'); return json(s.prices.get(decodeURIComponent(path.slice(7))) ?? {}); }
    if (method === 'POST' && path === 'checkout/sessions') {
      assert.ok(key, 'a create without an idempotency key could charge twice');
      // The connection drops before Stripe sees the request.
      if (s.failure === 'before') throw new TypeError('fetch failed');
      const form = new URLSearchParams(init.body);
      if (!s.keys.has(key)) {
        const id = 'cs_live_' + hex(12), item = s.prices.get(form.get('line_items[0][price]')), metadata = {};
        for (const [name, value] of form) if (name.startsWith('metadata[')) metadata[name.slice(9, -1)] = value;
        s.sessions.set(id, { id, object: 'checkout.session', livemode: true, mode: 'payment', client_reference_id: form.get('client_reference_id'), metadata,
          amount_total: item.unit_amount, amount_subtotal: item.unit_amount, currency: item.currency, status: 'open', payment_status: 'unpaid',
          url: 'https://checkout.stripe.com/c/pay/' + id, expires_at: Number(form.get('expires_at')), total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 }, payment_intent: null });
        s.lines.set(id, { quantity: Number(form.get('line_items[0][quantity]')), price: { id: item.id }, amount_total: item.unit_amount, amount_subtotal: item.unit_amount, currency: item.currency });
        s.keys.set(key, id);
      }
      // The session exists at Stripe, but its answer never arrives.
      if (s.failure === 'after') throw new TypeError('fetch failed');
      return json(s.view(s.keys.get(key)));
    }
    if (method === 'GET' && path.startsWith('checkout/sessions/')) return json(s.view(decodeURIComponent(path.slice(18)), true));
    if (method === 'GET' && path.startsWith('payment_intents/')) return json(s.intents.get(path.slice(16)) ?? {});
    if (method === 'GET' && path.startsWith('charges/')) return json(s.charges.get(path.slice(8)) ?? {});
    throw new Error('unexpected Stripe request ' + method + ' ' + path);
  };
  return s;
}

function setup(extra = {}) {
  let clock = NOW;
  const dir = mkdtempSync(join(tmpdir(), 'oathra-purchase-')), key = randomBytes(32).toString('hex'), token = randomBytes(32).toString('hex'), otherToken = randomBytes(32).toString('hex');
  const users = [{ id: randomUUID(), team: 'local', role: 'admin', tokenHash: hash(token) }, { id: randomUUID(), team: 'other', role: 'operator', tokenHash: hash(otherToken) }];
  const env = { OATHRA_USERS_JSON: JSON.stringify(users), OATHRA_DATA_KEY: key, OATHRA_DB: join(dir, 'purchases.sqlite'), OATHRA_DEPLOYMENT: 'managed', OATHRA_CREDITS_PER_CALL: '3',
    OATHRA_MODE: 'live', OATHRA_PUBLIC_URL: PUBLIC, STRIPE_SECRET_KEY: SECRET, STRIPE_WEBHOOK_SECRET: WHSEC, OATHRA_COMMERCE_URL: PUBLIC + '/commerce', OATHRA_SUPPORT_URL: PUBLIC + '/support',
    OATHRA_CREDIT_PACKS_JSON: JSON.stringify(PACKS), ...extra };
  // The carrier and voice settings are not part of this boundary; the purchase code only asks whether the service is live.
  const config = configuration(env); config.liveReady = true;
  const store = new Store(config.dbPath, key, () => clock), service = new Service(store, config), purchases = new Purchases(service, env), stripe = fakeStripe();
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const host = new URL(String(url)).hostname;
    if (host === 'api.stripe.com') return stripe.fetch(url, init);
    if (host === '127.0.0.1') return real(url, init);
    throw new Error('unexpected outbound request to ' + host);
  };
  const sign = (raw, t = Math.floor(clock / 1000), secret = WHSEC) => `t=${t},v1=${createHmac('sha256', secret).update(t + '.').update(raw).digest('hex')}`;
  const event = (type, object, id = 'evt_' + hex(10)) => Buffer.from(JSON.stringify({ id, object: 'event', api_version: STRIPE_API_VERSION, type, livemode: true, data: { object } }));
  const deliver = (type, object, id) => { const raw = event(type, object, id); return purchases.webhook(raw, sign(raw)); };
  const u = users[0];
  return { dir, key, env, token, otherToken, users, u, config, store, service, purchases, stripe, sign, event, deliver,
    advance(ms) { clock += ms; },
    balance: (owner = u.id) => ({ ...service.credits.balance(owner) }),
    grants: (owner = u.id) => service.credits.history(owner).filter(e => e.kind === 'grant'),
    saved: id => store.get('credit-purchase', id),
    sessionOf: id => store.get('credit-purchase', id).sessionId,
    /** A checkout that Stripe has since been paid for; the gateway has not been told yet. */
    async paid(input = STARTER) { const order = await purchases.checkout(u, input, 'checkout-' + hex(6)); const sessionId = store.get('credit-purchase', order.id).sessionId; return { order, sessionId, ...stripe.pay(sessionId) }; },
    close() { globalThis.fetch = real; store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const using = (fn, extra) => async () => { const f = setup(extra); try { await fn(f); } finally { f.close(); } };

test('a webhook signature is an HMAC over the exact bytes, one current timestamp, v1 only', () => {
  const raw = Buffer.from('{ "id": "evt_1", "object": "event", "note": "日本語" }'), t = Math.floor(NOW / 1000);
  const v1 = (body = raw, time = t, secret = WHSEC) => createHmac('sha256', secret).update(time + '.').update(body).digest('hex');
  assert.equal(stripeSignatureValid(raw, `t=${t},v1=${v1()}`, WHSEC, NOW), true);
  assert.equal(stripeSignatureValid(raw, `t=${t}, v1=${v1()}, v0=${'0'.repeat(64)}`, WHSEC, NOW), true);
  // During a secret rotation Stripe sends one v1 per secret; any one that matches is enough.
  assert.equal(stripeSignatureValid(raw, `t=${t},v1=${v1(raw, t, 'whsec_previous')},v1=${v1()}`, WHSEC, NOW), true);
  // The same JSON with different bytes is a different message.
  assert.equal(stripeSignatureValid(Buffer.from('{"id":"evt_1","object":"event","note":"日本語"}'), `t=${t},v1=${v1()}`, WHSEC, NOW), false);
  assert.equal(stripeSignatureValid(Buffer.from(raw.toString().replace('evt_1', 'evt_2')), `t=${t},v1=${v1()}`, WHSEC, NOW), false);
  assert.equal(stripeSignatureValid(raw.toString(), `t=${t},v1=${v1(raw.toString())}`, WHSEC, NOW), false);
  assert.equal(stripeSignatureValid(Buffer.alloc(0), `t=${t},v1=${v1(Buffer.alloc(0))}`, WHSEC, NOW), false);
  // Five minutes either way, to the second.
  for (const [offset, expected] of [[300, true], [301, false], [-300, true], [-301, false]]) assert.equal(stripeSignatureValid(raw, `t=${t},v1=${v1()}`, WHSEC, NOW + offset * 1000), expected, 'offset ' + offset);
  assert.equal(stripeSignatureValid(raw, `t=${t},v1=${v1()}`, WHSEC, NaN), false);
  // A second timestamp, even an identical one, is refused: which one was signed must never be a choice.
  assert.equal(stripeSignatureValid(raw, `t=${t},t=${t},v1=${v1()}`, WHSEC, NOW), false);
  assert.equal(stripeSignatureValid(raw, `t=${t - 1000},t=${t},v1=${v1()}`, WHSEC, NOW), false);
  assert.equal(stripeSignatureValid(raw, `v1=${v1()}`, WHSEC, NOW), false);
  assert.equal(stripeSignatureValid(raw, `t=${t}.5,v1=${v1(raw, t + '.5')}`, WHSEC, NOW), false);
  // v0 is the test-mode scheme; alone it proves nothing.
  assert.equal(stripeSignatureValid(raw, `t=${t},v0=${v1()}`, WHSEC, NOW), false);
  assert.equal(stripeSignatureValid(raw, `t=${t}`, WHSEC, NOW), false);
  for (const broken of [v1().slice(0, 62), v1() + '00', 'z'.repeat(64), '', v1() + '=extra']) assert.equal(stripeSignatureValid(raw, `t=${t},v1=${broken}`, WHSEC, NOW), false);
  // No secret, or one that is not a webhook secret, verifies nothing, even when the sender signed with the same value.
  for (const secret of [undefined, null, '', 'not-a-webhook-secret']) assert.equal(stripeSignatureValid(raw, `t=${t},v1=${v1(raw, t, String(secret ?? ''))}`, secret, NOW), false);
  assert.equal(stripeSignatureValid(raw, `t=${t},v1=${v1(raw, t, 'whsec_someone_else')}`, WHSEC, NOW), false);
  for (const header of [undefined, null, 42, [`t=${t},v1=${v1()}`], 'x'.repeat(5000)]) assert.equal(stripeSignatureValid(raw, header, WHSEC, NOW), false);
});

test('the webhook refuses unsigned, altered, stale, test-mode and connected-account events, and needs its secret', using(async f => {
  const { order, sessionId } = await f.paid(), raw = f.event('checkout.session.completed', f.stripe.view(sessionId));
  await assert.rejects(f.purchases.webhook(raw, undefined), fault('invalid_stripe_signature', 400));
  await assert.rejects(f.purchases.webhook(Buffer.concat([raw, Buffer.from(' ')]), f.sign(raw)), fault('invalid_stripe_signature', 400));
  await assert.rejects(f.purchases.webhook(raw, f.sign(raw, Math.floor(NOW / 1000) - 301)), fault('invalid_stripe_signature', 400));
  await assert.rejects(f.purchases.webhook(raw, f.sign(raw).replace('v1=', 'v0=')), fault('invalid_stripe_signature', 400));
  const t = Math.floor(NOW / 1000); await assert.rejects(f.purchases.webhook(raw, `t=${t},` + f.sign(raw)), fault('invalid_stripe_signature', 400));
  await assert.rejects(f.purchases.webhook(raw, f.sign(raw, undefined, 'whsec_someoneElse')), fault('invalid_stripe_signature', 400));
  for (const change of [{ livemode: false }, { account: 'acct_1Connected' }, { id: 'not-an-event' }, { object: 'charge' }]) {
    const altered = Buffer.from(JSON.stringify({ ...JSON.parse(raw.toString()), ...change }));
    await assert.rejects(f.purchases.webhook(altered, f.sign(altered)), fault('invalid_stripe_event', 400));
  }
  const text = Buffer.from('not json'); await assert.rejects(f.purchases.webhook(text, f.sign(text)), fault('invalid_stripe_event', 400));
  for (const missing of [{ STRIPE_WEBHOOK_SECRET: undefined }, { STRIPE_WEBHOOK_SECRET: '' }, { STRIPE_SECRET_KEY: undefined }, { STRIPE_SECRET_KEY: SECRET.replace('live', 'test') }])
    await assert.rejects(new Purchases(f.service, { ...f.env, ...missing }).webhook(raw, f.sign(raw)), fault('purchases_not_configured', 503));
  assert.deepEqual(f.balance(), { available: 0, held: 0 }); assert.equal(f.saved(order.id).status, 'OPEN');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM purchase_events').get().n, 0);
  // The untouched bytes with their own signature are accepted.
  assert.deepEqual(await f.purchases.webhook(raw, f.sign(raw)), { received: true });
  assert.deepEqual(f.balance(), { available: 3, held: 0 });
}));

test('one payment grants once: a redelivered event, a second event and simultaneous deliveries add nothing', using(async f => {
  const { order, sessionId } = await f.paid(), id = 'evt_' + hex(8), object = f.stripe.view(sessionId);
  assert.deepEqual(f.balance(), { available: 0, held: 0 }, 'opening a checkout page grants nothing');
  assert.deepEqual(await f.deliver('checkout.session.completed', object, id), { received: true });
  assert.deepEqual(f.balance(), { available: 3, held: 0 });
  assert.deepEqual(await f.deliver('checkout.session.completed', object, id), { received: true, replayed: true });
  // A different event about the same session, and the buyer's own status check, reach the same grant reference.
  assert.deepEqual(await f.deliver('checkout.session.async_payment_succeeded', object), { received: true });
  await Promise.all([f.deliver('checkout.session.completed', object), f.deliver('checkout.session.completed', object), f.purchases.reconcile(f.u, order.id)]);
  assert.deepEqual(f.balance(), { available: 3, held: 0 });
  assert.equal(f.grants().length, 1); assert.equal(f.grants()[0].amount, 3); assert.equal(f.grants()[0].reference, 'stripe:' + sessionId);
  const saved = f.saved(order.id); assert.equal(saved.status, 'PAID'); assert.equal(saved.creditedAt, NOW);
  assert.equal(f.store.audits({ limit: 500 }).filter(a => a.action === 'purchase.credited').length, 1);
  // The grant survives a restart, and so does the event's identity.
  const reopened = new Store(f.config.dbPath, f.key, () => NOW);
  try {
    const again = new Purchases(new Service(reopened, f.config), f.env), raw = f.event('checkout.session.completed', object, id);
    assert.deepEqual(await again.webhook(raw, f.sign(raw)), { received: true, replayed: true });
    assert.equal(again.service.credits.balance(f.u.id).available, 3);
  } finally { reopened.close(); }
}));

test('an event for another product is acknowledged and ignored; one that claims this service without an order is refused', using(async f => {
  assert.deepEqual(await f.deliver('customer.created', { id: 'cus_1', object: 'customer' }), { received: true, ignored: true });
  assert.deepEqual(await f.deliver('checkout.session.completed', { id: 'cs_live_other', object: 'checkout.session', metadata: { product: 'something else' } }), { received: true, ignored: true });
  const { order, sessionId } = await f.paid(), object = f.stripe.view(sessionId);
  await assert.rejects(f.deliver('checkout.session.completed', { ...object, metadata: { ...object.metadata, oathra_order: randomUUID() } }), fault('purchase_record_missing', 409));
  assert.deepEqual(f.balance(), { available: 0, held: 0 }); assert.equal(f.saved(order.id).status, 'OPEN');
}));

const MISMATCHES = {
  'a different total': s => { s.session.amount_total = 100; s.session.amount_subtotal = 100; },
  'a discount': s => { s.session.total_details.amount_discount = 500; },
  'a different currency': s => { s.session.currency = 'usd'; },
  'different credits in the metadata': s => { s.session.metadata.oathra_credits = '30'; },
  'another owner in the metadata': s => { s.session.metadata.oathra_owner = randomUUID(); },
  'a test-mode session': s => { s.session.livemode = false; },
  'two units on the line': s => { s.line.quantity = 2; },
  'another price on the line': s => { s.line.price.id = 'price_1Large'; },
  'a payment that received less': s => { s.intent.amount_received = 499; },
  'an uncaptured charge': s => { s.charge.captured = false; },
};
for (const [name, alter] of Object.entries(MISMATCHES)) test('a paid session with ' + name + ' blocks the order and grants nothing', using(async f => {
  const { order, sessionId, pi, ch } = await f.paid(), event = f.stripe.view(sessionId);
  alter({ session: f.stripe.sessions.get(sessionId), line: f.stripe.lines.get(sessionId), intent: f.stripe.intents.get(pi), charge: f.stripe.charges.get(ch) });
  // The event still describes the order that was requested; Stripe's current record does not.
  await assert.rejects(f.deliver('checkout.session.completed', event), error => { assert.match(error.code, /^stripe_(session|amount|line_items|payment|charge)_mismatch$/); assert.equal(error.status, 409); return true; });
  const saved = f.saved(order.id);
  assert.equal(saved.status, 'BLOCKED'); assert.equal(saved.blockReason, 'payment_record_mismatch'); assert.equal(saved.creditedAt, undefined);
  assert.deepEqual(f.balance(), { available: 0, held: 0 }); assert.equal(f.grants().length, 0);
  assert.equal(f.service.account(f.u).purchaseBlocked, true);
  // Later deliveries and status checks cannot unblock it or grant, even once Stripe's record looks right again.
  f.stripe.sessions.set(sessionId, event); f.stripe.pay(sessionId);
  const later = await f.purchases.reconcile(f.u, order.id);
  assert.equal(later.status, 'BLOCKED'); assert.equal(later.reviewRequired, true);
  await f.deliver('checkout.session.completed', f.stripe.view(sessionId));
  assert.deepEqual(f.balance(), { available: 0, held: 0 });
  await assert.rejects(f.purchases.checkout(f.u, STARTER, 'after-block-' + hex(4)), fault('purchase_account_under_review', 409));
}));

test('an event whose own session contradicts the order is refused, grants nothing, and puts the order under review', using(async f => {
  const { order, sessionId } = await f.paid(), object = { ...f.stripe.view(sessionId), amount_total: 100, amount_subtotal: 100 };
  await assert.rejects(f.deliver('checkout.session.completed', object), fault('stripe_amount_mismatch', 409));
  assert.deepEqual(f.balance(), { available: 0, held: 0 }); assert.equal(f.grants().length, 0);
  assert.equal(f.saved(order.id).status, 'BLOCKED'); assert.equal(f.service.account(f.u).purchaseBlocked, true);
}));

test('a refund puts the purchase and the account under review, durably, without taking spent credits below zero', using(async f => {
  const { order, sessionId, pi, ch } = await f.paid();
  await f.deliver('checkout.session.completed', f.stripe.view(sessionId));
  // The credits are spent on a call before the refund arrives.
  const mission = { id: randomUUID(), owner: f.u.id, mode: 'live', creditQuote: f.service.credits.quote('live') };
  f.store.tx(() => { f.service.credits.reserveTx(mission); f.service.credits.captureTx(mission); });
  assert.deepEqual(f.balance(), { available: 0, held: 0 });
  Object.assign(f.stripe.charges.get(ch), { refunded: true, amount_refunded: 500 });
  assert.deepEqual(await f.deliver('charge.refunded', f.stripe.charges.get(ch)), { received: true });
  const saved = f.saved(order.id);
  assert.equal(saved.status, 'BLOCKED'); assert.equal(saved.blockReason, 'payment_refund_review'); assert.equal(saved.paymentIntentId, pi);
  assert.deepEqual(f.balance(), { available: 0, held: 0 });
  assert.ok(f.service.credits.history(f.u.id).every(e => e.amount > 0), 'no negative ledger entry is written');
  const account = f.service.account(f.u);
  assert.equal(account.purchaseBlocked, true); assert.equal(account.purchaseBlockReason, 'payment_refund_review'); assert.equal(account.purchaseBlockOrderId, order.id);
  assert.equal(f.store.audits({ limit: 500 }).filter(a => a.action === 'purchase.review_required').length, 1);
  // Blocked means blocked: no new purchase, no further grant from a late event, and it is still so after a restart.
  await assert.rejects(f.purchases.checkout(f.u, STARTER, 'after-refund-' + hex(4)), fault('purchase_account_under_review', 409));
  await f.deliver('checkout.session.completed', f.stripe.view(sessionId));
  assert.equal(f.grants().length, 1);
  const history = f.purchases.history(f.u); assert.equal(history.length, 1); assert.equal(history[0].status, 'BLOCKED'); assert.equal(history[0].reviewRequired, true); assert.equal(history[0].checkoutUrl, undefined);
  const reopened = new Store(f.config.dbPath, f.key, () => NOW);
  try {
    const service = new Service(reopened, f.config), again = new Purchases(service, f.env);
    assert.equal(service.account(f.u).purchaseBlocked, true); assert.equal(reopened.get('credit-purchase', order.id).status, 'BLOCKED');
    await assert.rejects(again.checkout(f.u, STARTER, 'after-restart-' + hex(4)), fault('purchase_account_under_review', 409));
    assert.deepEqual({ ...service.credits.balance(f.u.id) }, { available: 0, held: 0 });
  } finally { reopened.close(); }
  // Someone else's account is untouched.
  assert.equal(f.service.account(f.users[1]).purchaseBlocked, undefined);
}));

test('a dispute, found through its charge, blocks the purchase and leaves unspent credits where they are', using(async f => {
  const { order, sessionId, ch } = await f.paid();
  await f.deliver('checkout.session.completed', f.stripe.view(sessionId));
  f.stripe.charges.get(ch).disputed = true;
  assert.deepEqual(await f.deliver('charge.dispute.created', { id: 'dp_' + hex(8), object: 'dispute', charge: ch, amount: 500, currency: 'jpy', status: 'needs_response' }), { received: true });
  assert.equal(f.saved(order.id).status, 'BLOCKED'); assert.equal(f.saved(order.id).blockReason, 'payment_disputed');
  assert.equal(f.service.account(f.u).purchaseBlocked, true);
  assert.deepEqual(f.balance(), { available: 3, held: 0 });
  // A dispute that closes in the buyer's favour is still a human's decision here.
  await f.deliver('charge.dispute.closed', { id: 'dp_' + hex(8), object: 'dispute', charge: ch, status: 'won' });
  assert.equal(f.service.account(f.u).purchaseBlocked, true); assert.equal(f.saved(order.id).status, 'BLOCKED');
  // A refund of some unrelated payment on the same Stripe account is none of this service's business.
  f.stripe.intents.set('pi_unrelated', { id: 'pi_unrelated', object: 'payment_intent', livemode: true, amount: 900, currency: 'jpy', metadata: {} });
  assert.deepEqual(await f.deliver('charge.refunded', { id: 'ch_unrelated', object: 'charge', payment_intent: 'pi_unrelated' }), { received: true, ignored: true });
}));

test('a payment already refunded or disputed when it is first read is never credited', using(async f => {
  for (const change of [{ refunded: true, amount_refunded: 500 }, { amount_refunded: 1 }, { disputed: true }]) {
    const g = setup();
    try {
      const { order, sessionId, ch } = await g.paid(); Object.assign(g.stripe.charges.get(ch), change);
      await g.deliver('checkout.session.completed', g.stripe.view(sessionId));
      assert.equal(g.saved(order.id).status, 'BLOCKED'); assert.equal(g.saved(order.id).blockReason, 'refund_or_dispute');
      assert.deepEqual(g.balance(), { available: 0, held: 0 }); assert.equal(g.grants().length, 0); assert.equal(g.service.account(g.u).purchaseBlocked, true);
    } finally { g.close(); }
  }
  assert.equal(f.grants().length, 0);
}));

test('checkout: one idempotency key is one order and one Stripe session; a second purchase waits for the first', using(async f => {
  const first = await f.purchases.checkout(f.u, STARTER, 'buyer-key-0001');
  assert.equal(first.status, 'OPEN'); assert.equal(first.credits, 3); assert.equal(first.amount, 500); assert.equal(first.currency, 'jpy');
  assert.equal(new URL(first.checkoutUrl).hostname, 'checkout.stripe.com');
  const [create] = f.stripe.creates(); assert.equal(create.key, 'oathra-purchase-' + first.id);
  const session = f.stripe.sessions.get(f.sessionOf(first.id));
  // What Stripe was asked for is the server's own order, bound to this owner and this service.
  assert.equal(session.client_reference_id, first.id); assert.equal(session.metadata.oathra_order, first.id); assert.equal(session.metadata.oathra_owner, f.u.id);
  assert.equal(session.metadata.oathra_credits, '3'); assert.equal(session.metadata.oathra_amount, '500'); assert.equal(f.stripe.lines.get(session.id).quantity, 1);
  assert.equal(session.expires_at, Math.floor(NOW / 1000) + 86400);
  const again = await f.purchases.checkout(f.u, STARTER, 'buyer-key-0001');
  assert.equal(again.id, first.id); assert.equal(again.checkoutUrl, first.checkoutUrl);
  assert.equal(f.stripe.creates().length, 1); assert.equal(f.stripe.sessions.size, 1); assert.equal(f.store.list('credit-purchase').length, 1);
  // The same key cannot be pointed at a different purchase.
  await assert.rejects(f.purchases.checkout(f.u, LARGE, 'buyer-key-0001'), fault('idempotency_conflict', 409));
  // A new key while the first is unsettled is refused, whatever the pack.
  await assert.rejects(f.purchases.checkout(f.u, STARTER, 'buyer-key-0002'), fault('purchase_pending_reconcile', 409));
  await assert.rejects(f.purchases.checkout(f.u, LARGE, 'buyer-key-0003'), fault('purchase_pending_reconcile', 409));
  assert.equal(f.stripe.creates().length, 1); assert.equal(f.store.list('credit-purchase').length, 1);
  // Another account is not held up by it, and keys are per owner.
  const other = await f.purchases.checkout(f.users[1], STARTER, 'buyer-key-0001'); assert.notEqual(other.id, first.id);
  await assert.rejects(f.purchases.reconcile(f.users[1], first.id), fault('not_found', 404));
  // Once the first is paid and credited, the next purchase may start.
  f.stripe.pay(session.id); const settled = await f.purchases.reconcile(f.u, first.id);
  assert.equal(settled.status, 'PAID'); assert.equal(settled.balance.available, 3); assert.equal(settled.checkoutUrl, undefined);
  assert.equal((await f.purchases.checkout(f.u, LARGE, 'buyer-key-0004')).status, 'OPEN');
  for (const key of [undefined, '', 'short', 'has space in it', 'x'.repeat(129)]) await assert.rejects(f.purchases.checkout(f.u, STARTER, key), fault('invalid_idempotency_key', 400));
  await assert.rejects(f.purchases.checkout({ ...f.u, role: 'viewer' }, STARTER, 'buyer-key-0005'), fault('read_only_account', 403));
}));

test('checkout: the quantity, price and currency the buyer was shown must be the server\'s', using(async f => {
  for (const shown of [{ ...STARTER, credits: 30 }, { ...STARTER, credits: 2 }, { ...STARTER, amount: 499 }, { ...STARTER, amount: 1 }, { ...STARTER, currency: 'usd' }])
    await assert.rejects(f.purchases.checkout(f.u, shown, 'shown-' + hex(6)), fault('purchase_price_changed_review_again', 409));
  for (const shown of [{ ...STARTER, credits: 0 }, { ...STARTER, credits: -3 }, { ...STARTER, credits: 1.5 }, { ...STARTER, credits: '3' }, { ...STARTER, amount: '500' }, { packId: 'starter' }, null])
    await assert.rejects(f.purchases.checkout(f.u, shown, 'shown-' + hex(6)), fault('review_purchase_price', 400));
  await assert.rejects(f.purchases.checkout(f.u, { ...STARTER, packId: 'not-a-pack' }, 'shown-' + hex(6)), fault('unknown_credit_pack', 400));
  // Stripe's price moved after the page was shown: the buyer must look again.
  f.stripe.prices.get('price_1Starter').unit_amount = 600;
  await assert.rejects(f.purchases.checkout(f.u, STARTER, 'shown-' + hex(6)), fault('purchase_price_changed_review_again', 409));
  // A price that is archived, test-mode or recurring is not sold at all.
  for (const change of [{ active: false }, { livemode: false }, { type: 'recurring', recurring: { interval: 'month' } }, { unit_amount: 0 }]) {
    const original = { ...f.stripe.prices.get('price_1Large') }; Object.assign(f.stripe.prices.get('price_1Large'), change);
    await assert.rejects(f.purchases.checkout(f.u, LARGE, 'shown-' + hex(6)), fault('stripe_price_unavailable', 503));
    f.stripe.prices.set('price_1Large', original);
  }
  assert.equal(f.store.list('credit-purchase').length, 0); assert.equal(f.stripe.creates().length, 0);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM purchase_keys').get().n, 0);
}));

test('while the prerelease is paused no purchase starts, but a session that already exists is still reconciled', using(async f => {
  assert.equal(f.config.prerelease.enabled, true); assert.equal(f.config.prerelease.paused, false);
  assert.equal((await f.purchases.status()).enabled, true);
  const order = await f.purchases.checkout(f.u, STARTER, 'before-pause-01'), sessionId = f.sessionOf(order.id);
  f.config.prerelease.paused = true;
  assert.deepEqual(await f.purchases.status(), { enabled: false, provider: 'stripe', live: false, reason: 'prerelease_paused', packs: [] });
  await assert.rejects(f.purchases.checkout(f.users[1], STARTER, 'during-pause-01'), fault('prerelease_paused', 503));
  // Not even a retry of the buyer's own key hands out a checkout page while paused.
  await assert.rejects(f.purchases.checkout(f.u, STARTER, 'before-pause-01'), fault('prerelease_paused', 503));
  assert.equal(f.stripe.creates().length, 1); assert.equal(f.store.list('credit-purchase').length, 1);
  // The buyer had the page open and paid. Their money is real; the pause must not lose it.
  f.stripe.pay(sessionId);
  assert.deepEqual(await f.deliver('checkout.session.completed', f.stripe.view(sessionId)), { received: true });
  assert.equal(f.saved(order.id).status, 'PAID'); assert.deepEqual(f.balance(), { available: 3, held: 0 });
  // A session that simply ran out during the pause is closed, so the buyer is not stuck behind it.
  f.config.prerelease.paused = false;
  const second = await f.purchases.checkout(f.users[1], STARTER, 'between-pauses-1'); f.config.prerelease.paused = true;
  f.stripe.sessions.get(f.sessionOf(second.id)).status = 'expired';
  await f.deliver('checkout.session.expired', f.stripe.view(f.sessionOf(second.id)));
  assert.equal(f.saved(second.id).status, 'EXPIRED'); assert.deepEqual(f.balance(f.users[1].id), { available: 0, held: 0 });
}, { OATHRA_RELEASE_STAGE: 'prerelease', OATHRA_PRERELEASE_PAUSED: 'false' }));

test('purchases are closed unless Stripe live keys, packs, policies and a live https service are all present', using(async f => {
  const reason = (env, change = {}) => new Purchases({ ...f.service, store: f.store, config: { ...f.config, ...change }, credits: f.service.credits, write: u => f.service.write(u), account: u => f.service.account(u) }, { ...f.env, ...env }).unavailableReason();
  assert.equal(reason({}), null);
  assert.equal(reason({ STRIPE_SECRET_KEY: SECRET.replace('live', 'test') }), 'purchases_not_configured');
  assert.equal(reason({ STRIPE_WEBHOOK_SECRET: undefined }), 'purchases_not_configured');
  for (const packs of ['[]', 'not json', JSON.stringify([{ id: 'a', priceId: 'price_1', credits: 0 }]), JSON.stringify([{ id: 'a', priceId: 'prod_1', credits: 1 }]), JSON.stringify([{ id: 'a', priceId: 'price_1', credits: 1 }, { id: 'a', priceId: 'price_2', credits: 1 }]), JSON.stringify([{ id: 'a', priceId: 'price_1', credits: 1.5 }])])
    assert.equal(reason({ OATHRA_CREDIT_PACKS_JSON: packs }), 'invalid_credit_packs');
  for (const change of [{ mode: 'simulator' }, { liveReady: false }, { deployment: 'self-hosted' }, { publicUrl: 'http://localhost:4244' }]) assert.equal(reason({}, change), 'purchases_require_live_service');
  for (const env of [{ OATHRA_COMMERCE_URL: undefined }, { OATHRA_SUPPORT_URL: 'http://gateway.oathra-purchase-check.dev/support' }, { OATHRA_SUPPORT_URL: 'mailto:support@oathra-purchase-check.dev' }]) assert.equal(reason(env), 'purchases_require_policies');
  // The catalogue shown to a buyer never carries the Stripe price id.
  const status = await f.purchases.status();
  assert.deepEqual(status.packs, [{ id: 'starter', credits: 3, name: 'スターター', amount: 500, currency: 'jpy' }, { id: 'large', credits: 30, name: 'large', amount: 4000, currency: 'jpy' }]);
}));

test('a lost answer leaves the order UNKNOWN; the retry repeats the same Stripe idempotency key and finds the same session', using(async f => {
  f.stripe.failure = 'after';
  const lost = await f.purchases.checkout(f.u, STARTER, 'lost-answer-01');
  assert.equal(lost.status, 'UNKNOWN'); assert.equal(lost.reviewRequired, true); assert.equal(lost.checkoutUrl, undefined);
  assert.equal(f.saved(lost.id).sessionId, undefined); assert.equal(f.stripe.sessions.size, 1);
  // UNKNOWN still counts as a purchase in progress: a fresh key cannot start a second charge beside it.
  await assert.rejects(f.purchases.checkout(f.u, STARTER, 'lost-answer-02'), fault('purchase_pending_reconcile', 409));
  // Still down: nothing changes, and every attempt carries the same key.
  assert.equal((await f.purchases.checkout(f.u, STARTER, 'lost-answer-01')).status, 'UNKNOWN');
  f.stripe.failure = 'status';
  assert.equal((await f.purchases.reconcile(f.u, lost.id)).status, 'UNKNOWN');
  f.stripe.failure = null;
  const found = await f.purchases.checkout(f.u, STARTER, 'lost-answer-01');
  assert.equal(found.id, lost.id); assert.equal(found.status, 'OPEN'); assert.ok(found.checkoutUrl);
  const creates = f.stripe.creates();
  assert.equal(creates.length, 4); assert.deepEqual([...new Set(creates.map(c => c.key))], ['oathra-purchase-' + lost.id]);
  assert.equal(f.stripe.sessions.size, 1, 'Stripe holds one session for the four attempts');
  assert.equal(f.store.list('credit-purchase').length, 1);
  f.stripe.pay(f.sessionOf(lost.id));
  assert.equal((await f.purchases.reconcile(f.u, lost.id)).status, 'PAID'); assert.deepEqual(f.balance(), { available: 3, held: 0 });
}));

test('a request that never reached Stripe is retried under the same key, but never after 23 hours', using(async f => {
  f.stripe.failure = 'before';
  const lost = await f.purchases.checkout(f.u, STARTER, 'never-sent-01');
  assert.equal(lost.status, 'UNKNOWN'); assert.equal(f.stripe.sessions.size, 0);
  // Stripe forgets idempotency keys after a day: past 23 hours a repeat could be a second session, so none is sent.
  f.advance(23 * 3600_000); f.stripe.failure = null;
  const before = f.stripe.creates().length;
  const late = await f.purchases.checkout(f.u, STARTER, 'never-sent-01');
  assert.equal(late.status, 'UNKNOWN'); assert.equal(late.reviewRequired, true);
  assert.equal((await f.purchases.reconcile(f.u, lost.id)).status, 'UNKNOWN');
  assert.equal(f.stripe.creates().length, before); assert.equal(f.stripe.sessions.size, 0);
  assert.deepEqual([...new Set(f.stripe.creates().map(c => c.key))], ['oathra-purchase-' + lost.id]);
}));

test('a status check while purchases are unavailable never sends the saved request to Stripe', using(async f => {
  f.stripe.failure = 'before';
  const lost = await f.purchases.checkout(f.u, STARTER, 'paused-retry-01'); f.stripe.failure = null;
  f.config.liveReady = false;
  const before = f.stripe.creates().length;
  assert.equal((await f.purchases.reconcile(f.u, lost.id)).status, 'UNKNOWN');
  assert.equal(f.stripe.creates().length, before);
  f.config.liveReady = true;
  assert.equal((await f.purchases.reconcile(f.u, lost.id)).status, 'OPEN');
}));

test('HTTP: checkout needs a signed-in owner; only a signed webhook grants; orders are owner scoped', using(async f => {
  const app = await createGateway(f.config, { store: f.store, env: f.env, execute: simulate, channels: { process: async () => {}, send: async () => {} } });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  try {
    const base = 'http://127.0.0.1:' + app.server.address().port;
    const call = async (path, { token, body, key, method = body ? 'POST' : 'GET' } = {}) => {
      const r = await fetch(base + path, { method, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...(key ? { 'idempotency-key': key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: r.status, body: await r.json() };
    };
    const hook = async (raw, signature) => { const r = await fetch(base + '/webhooks/stripe', { method: 'POST', headers: { 'content-type': 'application/json', ...(signature ? { 'stripe-signature': signature } : {}) }, body: raw }); return { status: r.status, body: await r.json() }; };
    const service = await call('/v1/public/service');
    assert.equal(service.body.purchases.enabled, true); assert.deepEqual(service.body.purchases.packs.map(p => [p.id, p.credits, p.unitAmount, p.currency]), [['starter', 3, 500, 'jpy'], ['large', 30, 4000, 'jpy']]);
    assert.ok(!JSON.stringify(service.body).includes('price_1'));
    assert.equal((await call('/v1/credits/checkout', { body: STARTER, key: 'http-checkout-1' })).status, 401);
    const wrong = await call('/v1/credits/checkout', { token: f.token, body: { ...STARTER, credits: 30 }, key: 'http-checkout-0' });
    assert.equal(wrong.status, 409); assert.equal(wrong.body.error, 'purchase_price_changed_review_again');
    const opened = await call('/v1/credits/checkout', { token: f.token, body: STARTER, key: 'http-checkout-1' });
    assert.equal(opened.status, 200); assert.equal(opened.body.status, 'OPEN'); assert.equal(new URL(opened.body.url).hostname, 'checkout.stripe.com'); assert.equal(opened.body.orderId, opened.body.id);
    const repeated = await call('/v1/credits/checkout', { token: f.token, body: STARTER, key: 'http-checkout-1' });
    assert.equal(repeated.body.orderId, opened.body.orderId); assert.equal(f.stripe.creates().length, 1);
    const pending = await call('/v1/credits/checkout', { token: f.token, body: STARTER, key: 'http-checkout-2' });
    assert.equal(pending.status, 409); assert.equal(pending.body.error, 'purchase_pending_reconcile');
    // Returning from the checkout page, or asking for the status, proves nothing while Stripe says unpaid.
    assert.equal((await call(`/v1/credits/purchases/${opened.body.orderId}/reconcile`, { token: f.token, body: {} })).body.status, 'OPEN');
    assert.equal((await call('/v1/credits', { token: f.token })).body.available, 0);
    const sessionId = f.sessionOf(opened.body.orderId); f.stripe.pay(sessionId);
    const raw = f.event('checkout.session.completed', f.stripe.view(sessionId));
    for (const signature of [undefined, 'garbage', f.sign(raw).replace('v1=', 'v0='), f.sign(raw, Math.floor(NOW / 1000) - 3600), f.sign(raw, undefined, 'whsec_guess')]) {
      const refused = await hook(raw, signature); assert.equal(refused.status, 400); assert.equal(refused.body.error, 'invalid_stripe_signature');
    }
    const altered = await hook(Buffer.from(raw.toString().replace('"livemode":true', '"livemode": true')), f.sign(raw)); assert.equal(altered.status, 400);
    assert.equal((await call('/v1/credits', { token: f.token })).body.available, 0);
    const accepted = await hook(raw, f.sign(raw)); assert.equal(accepted.status, 200); assert.deepEqual(accepted.body, { received: true });
    assert.deepEqual((await hook(raw, f.sign(raw))).body, { received: true, replayed: true });
    assert.equal((await call('/v1/credits', { token: f.token })).body.available, 3);
    const history = await call('/v1/credits/purchases', { token: f.token });
    assert.equal(history.body.purchases.length, 1); assert.equal(history.body.purchases[0].status, 'PAID'); assert.equal(history.body.purchases[0].unitAmount, 500);
    // The other account sees neither the order nor the credits.
    assert.equal((await call('/v1/credits/purchases', { token: f.otherToken })).body.purchases.length, 0);
    assert.equal((await call(`/v1/credits/purchases/${opened.body.orderId}/reconcile`, { token: f.otherToken, body: {} })).status, 404);
    assert.equal((await call('/v1/credits', { token: f.otherToken })).body.available, 0);
    // No response ever repeats what Stripe said, or the keys.
    f.stripe.failure = 'status';
    const down = await call(`/v1/credits/purchases/${opened.body.orderId}/reconcile`, { token: f.token, body: {} });
    assert.equal(down.status, 502); assert.equal(down.body.error, 'stripe_unavailable'); assert.ok(!JSON.stringify(down.body).includes('sk_'));
  } finally { await app.close(); }
}));
