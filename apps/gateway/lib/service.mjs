import { randomUUID } from 'node:crypto';
import { assert, Fault, hash, phone, random, text } from './security.mjs';

export const terminal = s => ['COMPLETED','INCOMPLETE','DECLINED','FAILED','CANCELLED','UNKNOWN'].includes(s);
export class Service {
  constructor(store, config) { this.store = store; this.config = config; }
  user(id) { const u = this.config.users.find(u => u.id === id); assert(u, 'unlinked_account', 403); return u; }
  auth(token) { const u = this.config.users.find(u => u.tokenHash === hash(token ?? '')); assert(u, 'unauthorized', 401); return u; }
  write(u) { assert(['admin','operator'].includes(u.role), 'read_only_account', 403); }
  own(kind, id, u) { const r = this.store.get(kind, id); assert(r && r.owner === u.id, 'not_found', 404); return r; }
  account(u) { return this.store.get('account', u.id) ?? { id: u.id, owner: u.id, consentVersion: null, verifiedPhone: null }; }
  saveConsent(u, version) { this.write(u); assert(version === this.config.consentVersion, 'review_current_privacy_notice'); this.store.audit(u.id, 'consent.saved', u.id, { version }); return this.store.put('account', { ...this.account(u), consentVersion: version, consentAt: this.store.now() }); }
  product(u, input) {
    this.write(u); assert(input.reviewed === true, 'product_facts_require_review');
    const old = input.id ? this.own('product', input.id, u) : null;
    const facts = text(input.facts, 12000), name = text(input.name, 100);
    const record = { id: old?.id ?? randomUUID(), owner: u.id, name, facts, source: String(input.source ?? '').slice(0,2048), revision: (old?.revision ?? 0) + 1,
      forbidden: '値引き・契約確定・支払い・未確認の機能や納期を約束しない。', reviewedAt: this.store.now() };
    this.store.audit(u.id, 'product.reviewed', record.id); return this.store.put('product', record);
  }
  contact(u, input) {
    this.write(u); assert(['inquiry','customer','consented'].includes(input.relationship), 'contact_relationship_required');
    const old = input.id ? this.own('contact', input.id, u) : null;
    const record = { id: old?.id ?? randomUUID(), owner: u.id, name: text(input.name, 100), phone: phone(input.phone), relationship: input.relationship,
      basis: text(input.basis, 1000), email: String(input.email ?? '').trim(), crmId: String(input.crmId ?? '').trim(), simulationOnly: input.simulationOnly === true };
    assert(!record.crmId || /^\d{1,30}$/.test(record.crmId), 'invalid_crm_contact_id');
    assert(!record.email || /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(record.email), 'invalid_email');
    this.store.audit(u.id, 'contact.saved', record.id); return this.store.put('contact', record);
  }
  prepare(u, input, origin = null, sourceKey = null, record = true) {
    assert(['admin','operator','agent'].includes(u.role), 'read_only_account', 403);
    if (sourceKey) { const found = this.store.key(`draft:${u.id}`, sourceKey); if (found) return this.own('mission', found, u); }
    const request = text(input.request, 2000), products = this.store.list('product', u.id), contacts = this.store.list('contact', u.id);
    const matchingProducts = products.filter(p => request.includes(p.name));
    const product = input.productId ? this.own('product', input.productId, u) : matchingProducts.length === 1 ? matchingProducts[0] : products.length === 1 ? products[0] : null;
    assert(product, 'select_one_reviewed_product');
    const self = input.testOnMe === true || /自分(?:に|へ)|テスト電話/.test(request);
    let target;
    if (self) { const account = this.account(u); assert(account.verifiedPhone, 'verify_your_phone_first'); target = { id: 'self', name: '自分へのテスト', phone: account.verifiedPhone, relationship: 'self' }; }
    else {
      const matches = contacts.filter(c => request.includes(c.name));
      target = input.contactId ? this.own('contact', input.contactId, u) : matches.length === 1 ? matches[0] : null;
      assert(target, 'select_one_contact');
    }
    const goal = input.goal ?? (/商談|打ち合わせ|日程|meeting/.test(request) ? 'meeting' : /資料|パンフレット/.test(request) ? 'materials' : 'introduce');
    assert(['meeting','materials','introduce'].includes(goal), 'invalid_goal');
    const seconds = Number(input.maxSeconds ?? 180), maxUsd = Number(input.maxUsd ?? this.config.maxCallUsd);
    assert(Number.isInteger(seconds) && seconds >= 30 && seconds <= this.config.maxSeconds, 'invalid_duration');
    assert(Number.isFinite(maxUsd) && maxUsd > 0 && maxUsd <= this.config.maxCallUsd, 'invalid_budget');
    const slots = input.candidateSlots ?? []; assert(Array.isArray(slots) && slots.length <= 8, 'invalid_slots');
    for (const s of slots) assert(typeof s === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(s) && Date.parse(s) > this.store.now(), 'slot_requires_future_time_and_timezone');
    const estimate = this.config.mode === 'simulator' ? 0 : Math.ceil((seconds + 30) / 60) * this.config.rateCeilingUsd * 2 + this.config.setupFeeUsd;
    assert(estimate <= maxUsd, 'estimated_cost_exceeds_budget');
    const m = { id: randomUUID(), owner: u.id, team: u.team, revision: 1, status: 'DRAFT', product, target, request, goal,
      candidateSlots: slots, testOnMe: self, mode: this.config.mode, maxSeconds: seconds, maxUsd, estimatedMaximumUsd: estimate,
      callerId: this.config.callerId ?? 'simulator', callPluginIdentity: this.config.callPluginIdentity ?? null, createdAt: this.store.now(), origin, sourceKey, result: null };
    this.store.tx(() => { this.store.put('mission', m); if (sourceKey) this.store.setKey(`draft:${u.id}`, sourceKey, m.id); if (record) this.store.audit(u.id, 'mission.drafted', m.id, { mission: m.id, target: this.store.phoneRef(m.target.phone), goal: m.goal, mode: m.mode, via: origin?.channel ?? 'api' }); });
    return m;
  }
  edit(u, id, input) {
    const m = this.own('mission', id, u); this.write(u); assert(m.status === 'DRAFT', 'mission_already_started', 409);
    const replacement = this.prepare(u, { request: input.request ?? m.request, productId: m.product.id, ...(m.testOnMe ? { testOnMe: true } : { contactId: m.target.id }),
      goal: input.goal ?? m.goal, maxSeconds: input.maxSeconds ?? m.maxSeconds, maxUsd: input.maxUsd ?? m.maxUsd, candidateSlots: input.candidateSlots ?? m.candidateSlots }, null, null, false);
    // The replacement only exists to reuse prepare()'s validation; it is not a mission anyone drafted or deleted.
    this.store.removeMission(replacement, false);
    const changed = { ...replacement, id: m.id, createdAt: m.createdAt, origin: m.origin, sourceKey: m.sourceKey, revision: m.revision + 1 };
    this.store.put('mission', changed); this.store.audit(u.id, 'mission.edited', m.id, { mission: m.id, revision: changed.revision, goal: changed.goal }); return changed;
  }
  fingerprint(m) { return hash(JSON.stringify([m.revision,m.product,m.target,m.request,m.goal,m.candidateSlots,m.maxSeconds,m.maxUsd,m.callerId,m.mode,m.callPluginIdentity??null])); }
  grant(u, m, action = 'start', extra = {}) {
    this.write(u); const token = random();
    this.store.setKey('approval', hash(token), JSON.stringify({ owner: u.id, mission: m.id, revision: m.revision, fingerprint: this.fingerprint(m), action, ...extra }), 300_000);
    return token;
  }
  review(u, id) { const m = this.own('mission', id, u); assert(m.status === 'DRAFT', 'mission_already_started', 409); return { mission: m, approvalToken: this.grant(u, m), expiresInSeconds: 300 }; }
  validGrant(u, token, action) {
    const raw = this.store.key('approval', hash(text(token, 200))); assert(raw, 'approval_expired_or_used', 409);
    const grant = JSON.parse(raw); assert(grant.owner === u.id && grant.action === action, 'approval_scope_mismatch', 403);
    const m = this.own('mission', grant.mission, u);
    assert(grant.revision === m.revision && grant.fingerprint === this.fingerprint(m), 'mission_changed_review_again', 409);
    return { grant, m };
  }
  checkPolicy(u, m) {
    const account = this.account(u);
    assert((m.callPluginIdentity??null)===(this.config.callPluginIdentity??null),'call_plugin_changed_review_again',409);
    assert(account.consentVersion === this.config.consentVersion, 'privacy_consent_required', 403);
    assert(!this.store.suppressed(u.team, m.target.phone), 'recipient_suppressed', 403);
    const p = this.own('product', m.product.id, u); assert(p.revision === m.product.revision, 'product_changed_review_again', 409);
    if (m.testOnMe) { assert(account.verifiedPhone === m.target.phone, 'verified_phone_changed', 409); if (m.mode === 'live') assert(account.phoneVerificationProvider === 'twilio-verify', 'real_phone_verification_required', 403); }
    else assert(this.own('contact', m.target.id, u).phone === m.target.phone, 'contact_changed_review_again', 409);
    assert(m.mode === this.config.mode && m.callerId === (this.config.callerId ?? 'simulator'), 'configuration_changed', 409);
    if (m.mode === 'live') assert(!m.target.simulationOnly, 'simulator_contact_not_valid_for_live',403);
    if (m.mode === 'live') assert(this.config.liveReady, 'live_provider_not_configured', 503);
  }
  start(u, token, idempotencyKey, acknowledged, expectedMissionId = null) {
    this.write(u); assert(acknowledged === true, 'explicit_call_approval_required', 403);
    const key = text(idempotencyKey, 150), tokenHash = hash(text(token, 200));
    return this.store.tx(() => {
      const previous = this.store.key(`start:${u.id}`, key);
      if (previous) { const old = JSON.parse(previous); assert(old.tokenHash === tokenHash && (!expectedMissionId || old.id === expectedMissionId), 'idempotency_conflict', 409); return this.own('mission', old.id, u); }
      const { m } = this.validGrant(u, token, 'start'); assert(!expectedMissionId || m.id === expectedMissionId, 'approval_scope_mismatch', 403); assert(m.status === 'DRAFT', 'mission_already_started', 409);
      this.checkPolicy(u, m);
      const recent = this.store.list('reservation', u.id).filter(x => x.approvedAt > this.store.now() - 86400_000);
      assert(recent.length < this.config.dailyCalls && recent.reduce((n,x) => n + x.estimatedMaximumUsd, 0) + m.estimatedMaximumUsd <= this.config.dailyUsd, 'daily_limit_reached', 429);
      assert(!this.store.list('mission',u.id).some(x => x.id!==m.id && x.target.phone === m.target.phone && ((x.status!=='DRAFT' && !terminal(x.status)) || x.status==='UNKNOWN')), 'recipient_has_active_call', 409);
      m.status = 'QUEUED'; m.approvedAt = this.store.now(); m.approvalExpiresAt = this.store.now() + 300_000;
      this.store.put('mission', m); this.store.put('reservation',{id:m.id,owner:u.id,approvedAt:m.approvedAt,estimatedMaximumUsd:m.estimatedMaximumUsd}); this.store.delKey('approval', tokenHash);
      this.store.setKey(`start:${u.id}`, key, JSON.stringify({ id: m.id, tokenHash }));
      this.store.audit(u.id, 'call.approved', m.id, { mission: m.id, revision: m.revision, fingerprint: this.fingerprint(m), target: this.store.phoneRef(m.target.phone), goal: m.goal, mode: m.mode, callerId: m.callerId, via: key.startsWith('channel:') ? (m.origin?.channel ?? 'channel') : 'api', actor: key.startsWith('channel:') ? hash(m.origin?.actor ?? '') : null });
      this.store.event(m, { type: 'status', status: m.status }); return m;
    });
  }
  cancel(u, id) {
    this.write(u); const m = this.own('mission', id, u);
    if (terminal(m.status)) return m;
    m.status = ['DRAFT','QUEUED'].includes(m.status) ? 'CANCELLED' : 'CANCEL_REQUESTED';
    if (m.status === 'CANCELLED') m.finishedAt = this.store.now();
    this.store.put('mission', m); this.store.audit(u.id, 'call.cancel_requested', m.id, { mission: m.id, status: m.status }); return m;
  }
  linkCode(u) { this.write(u); const code = random(); this.store.setKey('link', hash(code), u.id, 300_000); return code; }
  link(channel, actor, code) {
    return this.store.tx(() => {
      const owner = this.store.key('link', hash(code)); assert(owner, 'link_code_expired', 403); this.user(owner);
      const old = this.store.key(`identity:${channel}`, actor); assert(!old || old === owner, 'channel_already_linked', 409);
      this.store.setKey(`identity:${channel}`, actor, owner); this.store.delKey('link', hash(code));
      this.store.audit(owner, 'channel.linked', channel); return this.user(owner);
    });
  }
  channelUser(channel, actor) { return this.user(this.store.key(`identity:${channel}`, actor)); }
  notify(m, label, buttons = []) {
    if (!m.origin) return;
    this.store.enqueue('outbox', `${m.id}:${label}:${m.revision}`, m.owner, { ...m.origin, missionId: m.id, text: label === 'result' ? resultText(m) : label, buttons });
  }
}
export function reviewText(m) {
  const goals = { meeting: '商談日程の合意', materials: '資料送付の了承', introduce: '商品説明' };
  return `${m.mode === 'simulator' ? '【模擬・実際には発信しません】\n' : ''}${m.target.name} ${m.target.phone}\n発信元: ${m.callerId}\n商品: ${m.product.name}\n目的: ${goals[m.goal]}\n依頼: ${m.request}\n上限: ${m.maxSeconds}秒 / $${m.maxUsd}\n概算最大: $${m.estimatedMaximumUsd.toFixed(2)}（設定した料金単価による推定）\n値引き・契約・支払い不可。AIであることを名乗ります。\n詳細と個人情報の送信先を確認してから承認してください。`;
}
export function resultText(m) {
  const labels = { COMPLETED:'目的の合意を会話で確認', INCOMPLETE:'未確定の項目があります', DECLINED:'辞退・再連絡停止', FAILED:'実行失敗', UNKNOWN:'実行状態の照合が必要', CANCELLED:'キャンセル' };
  const r = m.result;
  return `${m.mode === 'simulator' ? '【模擬結果】\n' : ''}${labels[m.status] ?? m.status}\n${m.target.name}\n${JSON.stringify(r?.verified ?? {})}\n${r?.evidence?.filter(e => e.field === 'do_not_contact' || r.verified?.[e.field] === e.value).slice(-2).map(e => `根拠:「${e.quote}」`).join('\n') ?? ''}\n${r?.caveat ?? ''}`.slice(0,3500);
}
