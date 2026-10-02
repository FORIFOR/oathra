import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { assert, Fault, hash } from './security.mjs';

export const STRIPE_API_VERSION = '2025-02-24.acacia';
const KIND = 'credit-purchase';
const LIMIT = 1_000_000_000;
const CONTRACT = 'credit-purchase-v1';
const CHECKOUT_EVENTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired']);
const REVIEW_EVENTS = new Set(['charge.refunded', 'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed', 'refund.created', 'refund.updated']);
const active = status => ['CREATING', 'OPEN', 'PENDING', 'UNKNOWN'].includes(status);
const objectId = value => typeof value === 'string' ? value : value?.id;
function httpsUrl(value) { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } }

/** Verify the unmodified bytes before parsing. v0, duplicate timestamps and stale/future signatures are rejected. */
export function stripeSignatureValid(raw, signature, secret, now = Date.now()) {
  if (!Buffer.isBuffer(raw) || !raw.length || raw.length > 1_000_000 || typeof signature !== 'string' || signature.length > 4096 || typeof secret !== 'string' || !secret.startsWith('whsec_')) return false;
  const fields = signature.split(',').map(s => s.trim().split('='));
  const times = fields.filter(([name]) => name === 't');
  if (times.length !== 1 || times[0].length !== 2 || !/^\d{1,12}$/.test(times[0][1])) return false;
  const timestamp = times[0][1];
  if (!Number.isFinite(now) || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac('sha256', secret).update(timestamp + '.').update(raw).digest();
  return fields.some(([name, value, extra]) => name === 'v1' && extra === undefined && /^[a-f\d]{64}$/i.test(value ?? '') && timingSafeEqual(expected, Buffer.from(value, 'hex')));
}

/** Stripe is the payment authority; browser redirects and client amounts never grant credits. Single-node SQLite. */
export class Purchases {
  constructor(service, env = process.env) {
    this.service = service; this.store = service.store; this.config = service.config;
    this.secret = env.STRIPE_SECRET_KEY; this.webhookSecret = env.STRIPE_WEBHOOK_SECRET;
    this.commerceUrl = env.OATHRA_COMMERCE_URL; this.supportUrl = env.OATHRA_SUPPORT_URL;
    this.configurationError = null; this.packs = []; this.catalog = null; this.reconciliations = new Map();
    try {
      const packs = JSON.parse(env.OATHRA_CREDIT_PACKS_JSON ?? '[]');
      assert(Array.isArray(packs) && packs.length > 0 && packs.length <= 10, 'invalid_credit_packs');
      for (const p of packs) {
        assert(p && /^[a-zA-Z0-9_-]{1,64}$/.test(p.id) && /^price_[a-zA-Z0-9]{1,140}$/.test(p.priceId), 'invalid_credit_packs');
        assert(Number.isSafeInteger(p.credits) && p.credits > 0 && p.credits <= LIMIT, 'invalid_credit_packs');
        assert(p.name === undefined || (typeof p.name === 'string' && p.name.trim().length > 0 && p.name.length <= 80), 'invalid_credit_packs');
      }
      assert(new Set(packs.map(p => p.id)).size === packs.length && new Set(packs.map(p => p.priceId)).size === packs.length, 'invalid_credit_packs');
      this.packs = packs.map(p => ({ id: p.id, priceId: p.priceId, credits: p.credits, name: p.name?.trim() ?? p.id }));
    } catch { this.configurationError = 'invalid_credit_packs'; }
    this.store.db.exec(`CREATE TABLE IF NOT EXISTS purchase_keys(owner TEXT NOT NULL,key_hash TEXT NOT NULL,order_id TEXT NOT NULL,PRIMARY KEY(owner,key_hash));
      CREATE TABLE IF NOT EXISTS purchase_stripe_refs(kind TEXT NOT NULL,ref TEXT NOT NULL,order_id TEXT NOT NULL,PRIMARY KEY(kind,ref));
      CREATE TABLE IF NOT EXISTS purchase_events(id TEXT PRIMARY KEY,type TEXT NOT NULL,order_id TEXT,processed INTEGER NOT NULL);`);
  }
  stripeConfigured() { return typeof this.secret === 'string' && /^(sk|rk)_live_[a-zA-Z0-9]+$/.test(this.secret) && typeof this.webhookSecret === 'string' && /^whsec_[a-zA-Z0-9]+$/.test(this.webhookSecret); }
  unavailableReason() {
    if (this.config.prerelease?.enabled && this.config.prerelease.paused) return 'prerelease_paused';
    if (!this.stripeConfigured()) return 'purchases_not_configured';
    if (this.configurationError) return this.configurationError;
    if (this.config.deployment !== 'managed' || this.config.mode !== 'live' || !this.config.liveReady || !httpsUrl(this.config.publicUrl)) return 'purchases_require_live_service';
    if (!httpsUrl(this.commerceUrl) || !httpsUrl(this.supportUrl)) return 'purchases_require_policies';
    return null;
  }
  requireStripe() { assert(this.stripeConfigured(), 'purchases_not_configured', 503); }
  async request(path, { body, key } = {}) {
    this.requireStripe();
    let response;
    try {
      response = await fetch('https://api.stripe.com/v1/' + path, {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(12_000),
        headers: { Authorization: 'Bearer ' + this.secret, 'Stripe-Version': STRIPE_API_VERSION, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': key } : {}) },
        ...(body ? { body } : {})
      });
    } catch { throw new Fault(502, 'stripe_unavailable'); }
    // Never return Stripe's raw error body: it can contain request details and identifiers.
    assert(response.ok, 'stripe_unavailable', 502);
    try { const data = await response.json(); assert(data && typeof data === 'object', 'stripe_invalid_response', 502); return data; }
    catch { throw new Fault(502, 'stripe_invalid_response'); }
  }
  async price(pack) {
    const p = await this.request('prices/' + encodeURIComponent(pack.priceId) + '?expand[]=product');
    assert(p.id === pack.priceId && p.object === 'price' && p.active === true && p.livemode === true && p.type === 'one_time' && p.billing_scheme === 'per_unit' && !p.custom_unit_amount && !p.transform_quantity && !p.recurring && !p.tiers_mode, 'stripe_price_unavailable', 503);
    assert(p.product?.object === 'product' && p.product.active === true && p.product.livemode === true, 'stripe_price_unavailable', 503);
    assert(Number.isSafeInteger(p.unit_amount) && p.unit_amount > 0 && p.unit_amount <= LIMIT && /^[a-z]{3}$/.test(p.currency), 'stripe_price_unavailable', 503);
    return { ...pack, amount: p.unit_amount, currency: p.currency };
  }
  /** Read-only configuration inspection. Verification does not open purchase admission. */
  async inspectPrices({ refresh = false } = {}) {
    const reason = !this.stripeConfigured() ? 'purchases_not_configured' : this.configurationError;
    if (reason) return { verified: false, provider: 'stripe', live: false, reason, packs: [] };
    try {
      if (refresh || !this.catalog || this.catalog.until <= this.store.now()) this.catalog = { packs: await Promise.all(this.packs.map(p => this.price(p))), until: this.store.now() + 60_000 };
      return { verified: true, provider: 'stripe', live: true, packs: this.catalog.packs.map(({ priceId, ...p }) => p) };
    } catch { this.catalog = null; return { verified: false, provider: 'stripe', live: false, reason: 'stripe_prices_unavailable', packs: [] }; }
  }
  async status() {
    const reason = this.unavailableReason();
    if (reason) return { enabled: false, provider: 'stripe', live: false, reason, packs: [] };
    const { verified, ...inspection } = await this.inspectPrices();
    return { enabled: verified, ...inspection };
  }
  writable(user) { this.service.write(user); assert(!this.service.account(user).purchaseBlocked, 'purchase_account_under_review', 409); }
  order(user, id) { assert(typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id), 'not_found', 404); const o = this.store.get(KIND, id); assert(o?.owner === user.id, 'not_found', 404); return o; }
  publicOrder(o) {
    return { id: o.id, status: o.status, packId: o.packId, credits: o.credits, amount: o.amount, currency: o.currency, createdAt: o.createdAt, updatedAt: o.updatedAt,
      ...(o.status === 'OPEN' && o.checkoutUrl && o.expiresAt > this.store.now() ? { checkoutUrl: o.checkoutUrl } : {}),
      ...(o.creditedAt ? { creditedAt: o.creditedAt } : {}), ...(o.status === 'UNKNOWN' || o.status === 'BLOCKED' ? { reviewRequired: true } : {}) };
  }
  history(user) { return this.store.list(KIND, user.id).slice(0, 100).map(o => this.publicOrder(o)); }
  metadata(o) { return { oathra_contract: CONTRACT, oathra_service: hash(o.publicUrl).slice(0, 32), oathra_order: o.id, oathra_owner: o.owner, oathra_pack: o.packId, oathra_credits: String(o.credits), oathra_amount: String(o.amount), oathra_currency: o.currency }; }
  metadataMatches(o, meta) { return meta && Object.entries(this.metadata(o)).every(([k, v]) => meta[k] === v); }
  bindTx(kind, ref, orderId) {
    const prior = this.store.db.prepare('SELECT order_id FROM purchase_stripe_refs WHERE kind=? AND ref=?').get(kind, ref);
    assert(!prior || prior.order_id === orderId, 'stripe_reference_conflict', 409);
    if (!prior) this.store.db.prepare('INSERT INTO purchase_stripe_refs VALUES(?,?,?)').run(kind, ref, orderId);
  }
  update(id, change) { const current = this.store.get(KIND, id); assert(current, 'not_found', 404); return this.store.put(KIND, { ...current, ...change, updatedAt: this.store.now() }); }
  block(o, reason) {
    return this.store.tx(() => {
      const result = this.update(o.id, { status: 'BLOCKED', blockReason: reason });
      const account = this.store.get('account', o.owner) ?? { id: o.owner, owner: o.owner };
      this.store.put('account', { ...account, purchaseBlocked: true, purchaseBlockReason: reason, purchaseBlockOrderId: o.id });
      this.store.audit(o.owner, 'purchase.review_required', o.id, { reason });
      return result;
    });
  }
  async checkout(user, input, idempotencyKey) {
    this.writable(user);
    assert(typeof idempotencyKey === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(idempotencyKey), 'invalid_idempotency_key');
    assert(input && typeof input.packId === 'string' && Number.isSafeInteger(input.amount) && typeof input.currency === 'string' && Number.isSafeInteger(input.credits) && input.credits > 0 && input.credits <= LIMIT, 'review_purchase_price');
    assert(!this.unavailableReason(), this.unavailableReason() ?? 'purchases_not_configured', 503);
    const keyHash = hash(idempotencyKey);
    const priorId = this.store.db.prepare('SELECT order_id FROM purchase_keys WHERE owner=? AND key_hash=?').get(user.id, keyHash)?.order_id;
    if (priorId) {
      const prior = this.order(user, priorId);
      assert(prior.packId === input.packId && prior.amount === input.amount && prior.currency === input.currency && prior.credits === input.credits, 'idempotency_conflict', 409);
      return this.resume(prior);
    }
    const pack = this.packs.find(p => p.id === input.packId); assert(pack, 'unknown_credit_pack');
    // Fetch again at the purchase boundary even if the displayed catalog was cached.
    const price = await this.price(pack);
    assert(price.amount === input.amount && price.currency === input.currency && price.credits === input.credits, 'purchase_price_changed_review_again', 409);
    this.writable(user);
    const order = this.store.tx(() => {
      const raced = this.store.db.prepare('SELECT order_id FROM purchase_keys WHERE owner=? AND key_hash=?').get(user.id, keyHash)?.order_id;
      if (raced) { const o = this.order(user, raced); assert(o.packId === input.packId && o.amount === input.amount && o.currency === input.currency && o.credits === input.credits, 'idempotency_conflict', 409); return o; }
      assert(!this.store.some(KIND, o => o.owner === user.id && active(o.status)), 'purchase_pending_reconcile', 409);
      const balance = this.service.credits.balance(user.id);
      assert(balance.available + balance.held + price.credits <= LIMIT, 'credit_balance_limit', 409);
      const o = { id: randomUUID(), owner: user.id, status: 'CREATING', packId: price.id, priceId: price.priceId, credits: price.credits, amount: price.amount, currency: price.currency,
        createdAt: this.store.now(), updatedAt: this.store.now(), publicUrl: this.config.publicUrl };
      this.store.put(KIND, o); this.store.db.prepare('INSERT INTO purchase_keys VALUES(?,?,?)').run(user.id, keyHash, o.id);
      this.store.audit(user.id, 'purchase.requested', o.id, { packId: o.packId, credits: o.credits, amount: o.amount, currency: o.currency });
      return o;
    });
    return this.resume(order);
  }
  async resume(o) {
    o = this.store.get(KIND, o.id);
    if (o.status === 'BLOCKED') return this.publicOrder(o);
    if (o.sessionId) return this.reconcileOrder(o);
    // Stripe can prune idempotency keys after 24 hours. Never repeat an uncertain create after 23 hours.
    if (this.store.now() - o.createdAt >= 23 * 3600_000) return this.publicOrder(this.update(o.id, { status: 'UNKNOWN' }));
    const body = new URLSearchParams({ mode: 'payment', 'payment_method_types[0]': 'card', 'line_items[0][price]': o.priceId, 'line_items[0][quantity]': '1',
      'automatic_tax[enabled]': 'false', 'allow_promotion_codes': 'false', 'adaptive_pricing[enabled]': 'false',
      client_reference_id: o.id, success_url: o.publicUrl + '/?purchase=' + o.id, cancel_url: o.publicUrl + '/?purchase=' + o.id + '&cancelled=1',
      expires_at: String(Math.floor(o.createdAt / 1000) + 86400), locale: 'auto' });
    for (const [key, value] of Object.entries(this.metadata(o))) { body.set(`metadata[${key}]`, value); body.set(`payment_intent_data[metadata][${key}]`, value); }
    let session;
    try { session = await this.request('checkout/sessions', { body, key: 'oathra-purchase-' + o.id }); }
    catch {
      const latest = this.store.get(KIND, o.id);
      if (latest.sessionId || ['PAID', 'BLOCKED'].includes(latest.status)) return this.publicOrder(latest);
      return this.publicOrder(this.update(o.id, { status: 'UNKNOWN' }));
    }
    try {
      this.validateSession(o, session, false);
      this.store.tx(() => { this.bindTx('session', session.id, o.id); const latest = this.store.get(KIND, o.id); assert(!latest.sessionId || latest.sessionId === session.id, 'stripe_reference_conflict', 409); this.update(o.id, { sessionId: session.id }); });
      return await this.reconcileOrder(this.store.get(KIND, o.id));
    } catch (error) { if (error.code?.startsWith('stripe_') && error.status !== 502) this.block(o, 'payment_record_mismatch'); throw error; }
  }
  validateSession(o, s, lines = true) {
    assert(s?.object === 'checkout.session' && /^cs_live_[a-zA-Z0-9]+$/.test(s.id ?? '') && s.livemode === true && s.mode === 'payment' && s.client_reference_id === o.id && this.metadataMatches(o, s.metadata), 'stripe_session_mismatch', 409);
    assert(!o.sessionId || o.sessionId === s.id, 'stripe_session_mismatch', 409);
    assert(s.amount_total === o.amount && s.amount_subtotal === o.amount && s.currency === o.currency && (!s.total_details || (s.total_details.amount_discount === 0 && s.total_details.amount_shipping === 0 && s.total_details.amount_tax === 0)), 'stripe_amount_mismatch', 409);
    assert(['open', 'complete', 'expired'].includes(s.status) && ['paid', 'unpaid', 'no_payment_required'].includes(s.payment_status), 'stripe_session_mismatch', 409);
    if (lines) {
      const line = s.line_items?.data?.[0];
      assert(s.line_items?.has_more === false && s.line_items.data.length === 1 && line.quantity === 1 && objectId(line.price) === o.priceId && line.amount_total === o.amount && line.amount_subtotal === o.amount && line.currency === o.currency, 'stripe_line_items_mismatch', 409);
    }
  }
  async reconcile(user, id) { return this.reconcileOrder(this.order(user, id)); }
  async reconcileOrder(o) {
    this.requireStripe();
    if (o.status === 'BLOCKED') return this.publicOrder(o);
    if (!o.sessionId) {
      // A status check never starts a fresh payment: the same saved request is retried only while checkout is enabled.
      if (this.unavailableReason() || this.service.account({ id: o.owner }).purchaseBlocked) return this.publicOrder(o);
      return this.resume(o);
    }
    // Serialize reads per order. A webhook arriving during an older unpaid read must get a FRESH read
    // afterwards, not share that stale result and acknowledge the paid event without granting credits.
    // Unknown-create recovery stays outside this queue to avoid recursively waiting on itself.
    const pending = this.reconciliations.get(o.id) ?? Promise.resolve();
    const operation = pending.catch(() => {}).then(() => {
      const current = this.store.get(KIND, o.id);
      return current.status === 'BLOCKED' ? this.publicOrder(current) : this.readSession(current);
    });
    this.reconciliations.set(o.id, operation);
    try { return await operation; }
    finally { if (this.reconciliations.get(o.id) === operation) this.reconciliations.delete(o.id); }
  }
  async readSession(o) {
    const session = await this.request('checkout/sessions/' + encodeURIComponent(o.sessionId) + '?expand[]=line_items&expand[]=payment_intent.latest_charge');
    return this.acceptSession(o, session);
  }
  async acceptSession(o, s) {
    try { this.validateSession(o, s); }
    catch (error) { this.block(o, 'payment_record_mismatch'); throw error; }
    // An out-of-order expiry/completion delivery is checked against Stripe's current session, never event order.
    const latest = this.store.get(KIND, o.id);
    if (latest.status === 'BLOCKED') return this.publicOrder(latest);
    if (s.payment_status !== 'paid') {
      if (latest.creditedAt) return this.publicOrder(this.block(latest, 'payment_status_changed'));
      let checkoutUrl;
      if (s.status === 'open') {
        const url = new URL(s.url);
        assert(url.protocol === 'https:' && url.hostname === 'checkout.stripe.com' && !url.username && !url.password, 'stripe_checkout_url_mismatch', 409);
        checkoutUrl = url.href;
      }
      return this.publicOrder(this.update(o.id, { status: s.status === 'expired' ? 'EXPIRED' : s.status === 'open' ? 'OPEN' : 'PENDING', checkoutUrl, expiresAt: s.expires_at * 1000 }));
    }
    const pi = s.payment_intent, charge = pi?.latest_charge;
    try {
      assert(s.status === 'complete' && pi?.object === 'payment_intent' && /^pi_[a-zA-Z0-9]+$/.test(pi.id ?? '') && pi.status === 'succeeded' && pi.livemode === true && pi.amount === o.amount && pi.amount_received === o.amount && pi.currency === o.currency && this.metadataMatches(o, pi.metadata), 'stripe_payment_mismatch', 409);
    assert(charge?.object === 'charge' && /^ch_[a-zA-Z0-9]+$/.test(charge.id ?? '') && charge.livemode === true && objectId(charge.payment_intent) === pi.id && charge.paid === true && charge.captured === true && charge.status === 'succeeded' && charge.amount === o.amount && charge.currency === o.currency, 'stripe_charge_mismatch', 409);
    } catch (error) { this.block(o, 'payment_record_mismatch'); throw error; }
    this.store.tx(() => { this.bindTx('session', s.id, o.id); this.bindTx('intent', pi.id, o.id); this.update(o.id, { sessionId: s.id, paymentIntentId: pi.id }); });
    if (charge.refunded !== false || charge.amount_refunded !== 0 || charge.disputed !== false) return this.publicOrder(this.block(o, 'refund_or_dispute'));
    if (this.service.account({ id: o.owner }).purchaseBlocked) return this.publicOrder(this.block(o, 'account_under_review'));
    // grant() is itself transactional and idempotent. A crash before creditedAt is saved safely replays this same reference.
    let granted;
    try { granted = this.service.credits.grant({ id: 'stripe-checkout', role: 'admin' }, o.owner, o.credits, 'stripe:' + s.id, 'Stripe Checkout ' + o.id); }
    catch (error) {
      if (['credit_balance_limit', 'purchase_account_under_review', 'not_found'].includes(error.code)) return this.publicOrder(this.block(o, 'credit_grant_requires_review'));
      throw error;
    }
    const credited = this.store.get(KIND, o.id);
    if (credited.status === 'BLOCKED') return this.publicOrder(credited);
    const result = this.update(o.id, { status: 'PAID', creditedAt: credited.creditedAt ?? this.store.now(), checkoutUrl: undefined });
    if (!granted.replayed) this.store.audit(o.owner, 'purchase.credited', o.id, { credits: o.credits });
    return { ...this.publicOrder(result), balance: granted.balance };
  }
  async reviewEvent(event) {
    const obj = event.data.object;
    let intentId = objectId(obj.payment_intent);
    if (!intentId && obj.charge) { const charge = await this.request('charges/' + encodeURIComponent(objectId(obj.charge))); intentId = objectId(charge.payment_intent); }
    if (!intentId || !/^pi_[a-zA-Z0-9]+$/.test(intentId)) return null;
    const pi = await this.request('payment_intents/' + encodeURIComponent(intentId));
    const orderId = this.store.db.prepare("SELECT order_id FROM purchase_stripe_refs WHERE kind='intent' AND ref=?").get(intentId)?.order_id ?? pi.metadata?.oathra_order;
    const o = orderId && this.store.get(KIND, orderId);
    if (!o) { assert(pi.metadata?.oathra_contract !== CONTRACT || pi.metadata?.oathra_service !== hash(this.config.publicUrl).slice(0, 32), 'purchase_record_missing', 409); return null; }
    assert(pi.id === intentId && pi.livemode === true && this.metadataMatches(o, pi.metadata) && pi.amount === o.amount && pi.currency === o.currency, 'stripe_payment_mismatch', 409);
    this.store.tx(() => { this.bindTx('intent', intentId, o.id); this.update(o.id, { paymentIntentId: intentId }); });
    // Do not make balances negative or automatically undo spent credits. An operator must reconcile/refund first.
    this.block(o, event.type.startsWith('charge.dispute.') ? 'payment_disputed' : 'payment_refund_review');
    return o.id;
  }
  async webhook(raw, signature) {
    this.requireStripe();
    assert(stripeSignatureValid(raw, signature, this.webhookSecret, this.store.now()), 'invalid_stripe_signature', 400);
    let event; try { event = JSON.parse(raw.toString('utf8')); } catch { throw new Fault(400, 'invalid_stripe_event'); }
    assert(event?.object === 'event' && /^evt_[a-zA-Z0-9]+$/.test(event.id ?? '') && typeof event.type === 'string' && event.livemode === true && !event.account && event.data?.object, 'invalid_stripe_event', 400);
    if (this.store.db.prepare('SELECT id FROM purchase_events WHERE id=?').get(event.id)) return { received: true, replayed: true };
    let orderId = null;
    if (CHECKOUT_EVENTS.has(event.type)) {
      const supplied = event.data.object;
      const o = typeof supplied.metadata?.oathra_order === 'string' ? this.store.get(KIND, supplied.metadata.oathra_order) : null;
      if (!o) assert(supplied.metadata?.oathra_contract !== CONTRACT || supplied.metadata?.oathra_service !== hash(this.config.publicUrl).slice(0, 32), 'purchase_record_missing', 409);
      if (o) {
        this.validateSession(o, supplied, false);
        this.store.tx(() => { this.bindTx('session', supplied.id, o.id); this.update(o.id, { sessionId: supplied.id }); });
        await this.reconcileOrder(this.store.get(KIND, o.id)); orderId = o.id;
      }
    } else if (REVIEW_EVENTS.has(event.type)) orderId = await this.reviewEvent(event);
    this.store.db.prepare('INSERT OR IGNORE INTO purchase_events VALUES(?,?,?,?)').run(event.id, event.type, orderId, this.store.now());
    return { received: true, ...(orderId ? {} : { ignored: true }) };
  }
}
