/** Working through a list.
 *
 * A person approves, once and with the whole list in front of them, the same call to many saved contacts:
 * a sales call about one reviewed product, or one ordinary request (a delivery-date check with each supplier).
 * The calls then leave one at a time as lines come free, each through the ordinary draft, policy, calling-hours,
 * credit and suppression checks. A list is not a way around any of them: a contact who cannot be called is
 * skipped with the reason, a refusal suppresses that number as always, and nothing is redialled. */
import { preparePhoneRequest } from '../../../packages/contract/dist/index.js';
import { prepareManagedPhone } from './phone-service.mjs';
import { terminal } from './service.mjs';
import { assert, hash, text, Fault } from './security.mjs';

const BUSY = ['QUEUED', 'DIALING', 'ACTIVE', 'VERIFYING', 'CANCEL_REQUESTED'];
// Not this contact's fault and not permanent: try the same contact again on a later tick.
const LATER = ['outside_calling_hours', 'recipient_has_active_call', 'service_restarting_try_again_shortly', 'daily_limit_reached', 'prerelease_call_limit', 'prerelease_global_call_limit', 'prerelease_budget_limit', 'prerelease_global_budget_limit', 'prerelease_paused'];
// The account cannot pay for more: stop the list and tell the person, rather than failing every remaining contact.
const PAUSE = ['insufficient_credits', 'insufficient_connection_credits', 'monthly_cap_reached', 'purchase_account_blocked', 'privacy_consent_required'];
const canonical = value => JSON.stringify(value, (_k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);

export class Batches {
  constructor(service, alerts = null) { this.service = service; this.store = service.store; this.alerts = alerts; }

  create(owner, input, key) {
    const s = this.service; s.write(owner);
    assert(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(k => ['kind', 'contactIds', 'sales', 'request', 'acknowledged'].includes(k)), 'invalid_batch');
    assert(input.acknowledged === true, 'explicit_batch_approval_required', 403);
    assert(typeof key === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(key), 'idempotency_key_required');
    const id = hash(`batch:${owner.id}:${key}`).slice(0, 32), fingerprint = hash(canonical(input));
    return this.store.tx(() => {
      const old = this.store.get('batch', id);
      if (old) { assert(old.fingerprint === fingerprint, 'idempotency_conflict', 409); return this.view(old); }
      assert(s.account(owner).consentVersion === s.config.consentVersion, 'privacy_consent_required', 403);
      const ids = input.contactIds;
      assert(Array.isArray(ids) && ids.length >= 1 && ids.length <= 100 && new Set(ids).size === ids.length, 'batch_1_to_100_contacts');
      const contacts = ids.map(contactId => s.own('contact', contactId, owner));
      let spec;
      if (input.kind === 'sales') {
        const sales = input.sales; assert(sales && typeof sales === 'object' && Object.keys(sales).every(k => ['productId', 'request', 'goal'].includes(k)) && input.request === undefined, 'invalid_batch');
        const product = s.own('product', sales.productId, owner); // products are only ever saved as reviewed (service.product)
        assert(sales.goal === undefined || ['meeting', 'materials', 'introduce'].includes(sales.goal), 'invalid_goal');
        spec = { productId: product.id, request: text(sales.request, 2000), ...(sales.goal ? { goal: sales.goal } : {}) };
      } else {
        assert(input.kind === 'request' && input.request && typeof input.request === 'object' && input.sales === undefined, 'invalid_batch');
        assert(!('phone' in input.request) && !('name' in input.request), 'batch_request_names_no_recipient');
        // Validate the wording once against a placeholder recipient; each contact's own number and name are filled in at dispatch.
        let checked; try { checked = preparePhoneRequest({ ...input.request, phone: '+819000000000', name: '相手' }); } catch { throw new Fault(400, 'invalid_phone_request'); }
        assert(!checked.task, 'batch_cannot_reserve');
        const { phone, name, schemaVersion, kind, ...fields } = checked; spec = fields;
      }
      const items = contacts.map(c => {
        // Said now, so the person approving sees who will not be called and why.
        const reason = !c.phone ? 'contact_phone_required' : this.store.suppressed(owner.team, c.phone) ? 'recipient_suppressed' : c.simulationOnly && s.config.mode === 'live' ? 'simulator_contact_not_valid_for_live'
          : input.kind === 'sales' && !['inquiry', 'customer', 'consented'].includes(c.relationship) ? 'contact_relationship_required' : input.kind === 'sales' && !c.basis?.trim() ? 'contact_basis_required' : null;
        return { contactId: c.id, name: c.name || c.company, state: reason ? 'SKIPPED' : 'PENDING', ...(reason ? { reason } : {}) };
      });
      assert(items.some(i => i.state === 'PENDING'), 'batch_has_no_callable_contact');
      const batch = { id, owner: owner.id, team: owner.team, status: 'ACTIVE', fingerprint, kind: input.kind, spec, items, consentVersion: s.config.consentVersion, createdAt: this.store.now(), expiresAt: this.store.now() + 7 * 86400_000 };
      this.store.put('batch', batch);
      this.store.audit(owner.id, 'batch.created', id, { batch: id, kind: input.kind, contacts: items.length, callable: items.filter(i => i.state === 'PENDING').length });
      return this.view(batch);
    });
  }
  view(batch) {
    const { fingerprint, ...rest } = batch, count = state => batch.items.filter(i => i.state === state).length;
    return { ...rest, expiresAt: new Date(batch.expiresAt).toISOString(), counts: { pending: count('PENDING'), calling: count('CALLING'), done: count('DONE'), skipped: count('SKIPPED'), failed: count('FAILED') } };
  }
  list(owner) { return this.store.all('batch', owner.id).sort((a, b) => b.createdAt - a.createdAt).map(x => this.view(x)); }
  set(owner, id, status) {
    this.service.write(owner); assert(['ACTIVE', 'PAUSED', 'ENDED'].includes(status), 'invalid_batch_status');
    return this.store.tx(() => {
      const batch = this.service.own('batch', id, owner);
      assert(!['ENDED', 'FINISHED'].includes(batch.status), 'batch_ended', 409);
      if (status === 'ACTIVE') assert(batch.expiresAt > this.store.now(), 'batch_ended', 409);
      batch.status = status; delete batch.pausedReason;
      // Ending leaves calls already placed to finish; it only stops the ones not yet made.
      if (status === 'ENDED') for (const item of batch.items) if (item.state === 'PENDING') { item.state = 'SKIPPED'; item.reason = 'ended_by_owner'; }
      this.store.put('batch', batch); this.store.audit(owner.id, 'batch.' + status.toLowerCase(), id, { batch: id });
      return this.view(batch);
    });
  }

  /** Settles finished calls and starts the next ones onto free lines. Safe to call as often as the worker likes. */
  tick() {
    const now = this.store.now(); let inUse = 0; const lines = Math.max(1, this.service.config.maxConcurrentCalls ?? 1);
    this.store.some('mission', x => { if (BUSY.includes(x.status)) inUse++; return false; });
    for (const kind of ['ACTIVE', 'PAUSED']) for (const batch of this.store.list('batch', undefined, kind).sort((a, b) => a.createdAt - b.createdAt)) {
      let changed = false;
      for (const item of batch.items.filter(i => i.state === 'CALLING')) {
        const m = this.store.get('mission', item.missionId);
        if (m && !terminal(m.status)) continue;
        item.state = 'DONE'; item.outcome = m ? m.status : 'RECORD_DELETED'; changed = true;
      }
      if (batch.status === 'ACTIVE' && now >= batch.expiresAt) { for (const item of batch.items) if (item.state === 'PENDING') { item.state = 'SKIPPED'; item.reason = 'batch_expired'; } changed = true; }
      if (batch.status === 'ACTIVE') for (const item of batch.items) {
        if (item.state !== 'PENDING' || inUse >= lines) continue;
        const outcome = this.dispatch(batch, item); changed = true;
        if (outcome === 'queued') inUse++;
        else if (outcome === 'later') break;
        else if (outcome === 'pause') break;
      }
      if (!batch.items.some(i => ['PENDING', 'CALLING'].includes(i.state)) && batch.status !== 'FINISHED') { batch.status = 'FINISHED'; batch.finishedAt = now; changed = true; }
      if (changed) this.store.put('batch', batch);
    }
  }
  dispatch(batch, item) {
    const s = this.service;
    try {
      this.store.tx(() => {
        const owner = s.user(batch.owner); s.write(owner);
        assert(batch.consentVersion === s.config.consentVersion, 'privacy_consent_required', 403);
        const contact = s.own('contact', item.contactId, owner);
        const draft = batch.kind === 'sales'
          ? s.prepare(owner, { ...batch.spec, contactId: contact.id }, null, null, true, true)
          : prepareManagedPhone(s, owner, { ...batch.spec, phone: contact.phone, name: contact.name || contact.company });
        draft.batch = { id: batch.id }; this.store.put('mission', draft);
        const { approvalToken } = s.review(owner, draft.id);
        s.startTx(owner, approvalToken, `batch:${batch.id}:${item.contactId}`, true, draft.id);
        item.state = 'CALLING'; item.missionId = draft.id;
        this.store.audit(owner.id, 'batch.dispatched', draft.id, { batch: batch.id, mission: draft.id });
      });
      return 'queued';
    } catch (error) {
      const reason = error.code ?? 'dispatch_failed';
      if (LATER.includes(reason)) return 'later';
      if (PAUSE.includes(reason)) {
        batch.status = 'PAUSED'; batch.pausedReason = reason;
        this.alerts?.raise({ id: batch.id, owner: batch.owner, team: batch.team, origin: null, target: { name: `${batch.items.length}件のリスト` } }, 'batch', 'notice', { categories: [reason] });
        return 'pause';
      }
      item.state = reason === 'recipient_suppressed' ? 'SKIPPED' : 'FAILED'; item.reason = reason;
      return 'failed';
    }
  }
}
