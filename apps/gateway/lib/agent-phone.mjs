/** Experimental v1 delegated phone actions. Only an operator's persisted, bounded grant can authorize them. */
import { randomUUID, randomBytes } from 'node:crypto';
import { normalizePhoneNumber, preparePhoneRequest } from '../../../packages/contract/dist/index.js';
import { prepareManagedPhone, phoneRecord } from './phone-service.mjs';
import { terminal } from './service.mjs';
import { assert, hash, Fault } from './security.mjs';

const object = (value, keys) => assert(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => keys.includes(k)), 'invalid_agent_phone_request');
const canonical = value => JSON.stringify(value, function (_key, v) { return v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k,v[k]])) : v; });
const keyOf = (u, key) => { assert(typeof key === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(key), 'idempotency_key_required'); return hash(`${u.id}:${key}`); };
/** Contacts a sales call may reach: the same relationship and basis the web and MCP drafts require. */
const salesPermitted = (service, owner, c) => ['inquiry','customer','consented'].includes(c.relationship) && !!c.basis?.trim() && !!c.phone && !service.store.suppressed(owner.team, c.phone);
const cancelledBeforeDispatch = () => ({schemaVersion:1,missionId:null,state:'CANCELLED',terminal:true,outcome:'cancelled',successCriteria:null,result:null,record:null,nextAction:'review_result_do_not_redial'});

/** Server-owned trial defaults. A recipient is never inferred from call history. */
export function phoneGrantDefaults(service, owner) {
  service.write(owner);
  const c = service.config, account = service.account(owner), maxSeconds = Math.min(300, c.maxSeconds);
  const maxCallUsd = Math.ceil((Math.ceil((maxSeconds + 30) / 60) * c.rateCeilingUsd * 2 + c.setupFeeUsd) * 100) / 100;
  const phones = account.verifiedPhone && account.phoneVerificationProvider === 'twilio-verify' ? [account.verifiedPhone] : [];
  return {schemaVersion:1, defaults:{phones,maxCalls:10,maxSeconds,maxCallUsd,maxTotalUsd:Math.round(maxCallUsd*10*100)/100,expiresAt:new Date(service.store.now()+24*3600_000).toISOString(),allowReservation:false,allowSales:false,readInbound:false},
    ready:c.mode === 'live' && c.liveReady && maxCallUsd <= c.maxCallUsd && account.consentVersion === c.consentVersion && phones.length > 0,
    needsRecipient:phones.length === 0, needsConsent:account.consentVersion !== c.consentVersion,
    liveReady:c.mode === 'live' && c.liveReady, budgetFitsServer:maxCallUsd <= c.maxCallUsd, consentVersion:c.consentVersion,
    budgetBasis:'configured_cost_ceiling', disclosure:'実電話の試用枠です。10回・1通話最大5分（サーバー上限が短ければその値）・24時間。番号未登録時は宛先を指定してください。USDは設定単価による見積枠で、電話会社の最終請求の上限保証ではありません。接続だけでは発信しません。'};
}

/** Atomic, replayable credential + grant issuance; no static user configuration or restart needed. */
export function connectPhoneAgent(service, owner, input, key) {
  service.write(owner);
  object(input,['phones','maxCalls','maxTotalUsd','maxCallUsd','maxSeconds','expiresAt','allowReservation','allowSales','readInbound','acknowledged']);
  assert(input.acknowledged === true,'explicit_delegation_approval_required',403);
  const id = keyOf(owner,key), fingerprint = hash(canonical(input));
  return service.store.tx(() => {
    const old = service.store.get('phone-connection',id);
    if (old) { assert(old.owner === owner.id && old.fingerprint === fingerprint,'idempotency_conflict',409); return old.connection; }
    const token = randomBytes(32).toString('base64url');
    const agent = {id:'phone-agent-'+randomUUID(),owner:owner.id,team:owner.team,role:'agent',status:'ACTIVE',tokenHash:hash(token)};
    service.store.put('agent-identity',agent);
    service.store.setKey('agent-token',agent.tokenHash,agent.id);
    const grant = grantPhoneTx(service,owner,{...input,agentId:agent.id});
    const connection = {schemaVersion:1,kind:'oathra.agent-connection',baseUrl:service.config.publicUrl,token,agentId:agent.id,grantId:grant.id,grant};
    service.store.put('phone-connection',{id,owner:owner.id,fingerprint,connection});
    return connection;
  });
}

export function agentPhoneConnection(service, agent, grantId) {
  assert(agent.role === 'agent','agent_identity_required',403);
  const grant = service.store.get('phone-grant',grantId);
  assert(grant && grant.agentId === agent.id && grant.team === agent.team,'phone_grant_not_found',404);
  const calls = service.store.all('phone-dispatch',agent.id).filter(d=>d.grantId === grantId);
  const remainingCalls = Math.max(0,grant.maxCalls-calls.length);
  const remainingUsd = Math.max(0,grant.maxTotalUsd-calls.reduce((n,d)=>n+d.reservedUsd,0));
  let active = true;
  try { liveGrant(service,agent,grantId); } catch { active = false; }
  const liveReady = service.config.mode === 'live' && service.config.liveReady;
  return {schemaVersion:1,grant,remainingCalls,remainingUsd,ready:active && remainingCalls > 0 && remainingUsd+1e-9 >= grant.maxCallUsd && liveReady,
    nextAction:!active?'renew_with_operator':!liveReady?'configure_gateway':remainingCalls===0||remainingUsd+1e-9<grant.maxCallUsd?'trial_exhausted_request_new_grant':'submit_phone_request'};
}

/** Human/operator API: an explicit, revocable grant, kept encrypted with the other account data. */
export function grantPhone(service, owner, input) {
  return service.store.tx(() => grantPhoneTx(service,owner,input));
}
function grantPhoneTx(service, owner, input) {
  service.write(owner);
  object(input, ['agentId','phones','maxCalls','maxTotalUsd','maxCallUsd','maxSeconds','expiresAt','allowReservation','allowSales','readInbound','acknowledged']);
  input = {...phoneGrantDefaults(service,owner).defaults,...input};
  assert(input.acknowledged === true, 'explicit_delegation_approval_required', 403);
  const agent = service.user(input.agentId);
  assert(agent.role === 'agent' && agent.team === owner.team, 'agent_must_belong_to_owner_team', 403);
  assert(service.account(owner).consentVersion === service.config.consentVersion, 'privacy_consent_required', 403);
  assert(Array.isArray(input.phones) && input.phones.length > 0 && input.phones.length <= 100, 'explicit_recipients_required');
  let phones;
  try { phones = [...new Set(input.phones.map(normalizePhoneNumber))]; } catch { throw new Fault(400,'invalid_grant_phone'); }
  const maxCalls = input.maxCalls, maxTotalUsd = input.maxTotalUsd, maxCallUsd = input.maxCallUsd, maxSeconds = input.maxSeconds;
  assert(Number.isInteger(maxCalls) && maxCalls >= 1 && maxCalls <= 100, 'invalid_grant_call_limit');
  assert(Number.isFinite(maxCallUsd) && maxCallUsd > 0 && maxCallUsd <= service.config.maxCallUsd, 'invalid_grant_call_budget');
  assert(Number.isFinite(maxTotalUsd) && maxTotalUsd >= maxCallUsd && maxTotalUsd <= 1000, 'invalid_grant_total_budget');
  assert(Number.isInteger(maxSeconds) && maxSeconds >= 30 && maxSeconds <= service.config.maxSeconds, 'invalid_grant_duration');
  const expiresAt = Date.parse(input.expiresAt);
  assert(typeof input.expiresAt === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(input.expiresAt) && expiresAt > service.store.now() && expiresAt <= service.store.now() + 30 * 86400_000, 'grant_expiry_required_within_30_days');
  assert(input.allowReservation === undefined || typeof input.allowReservation === 'boolean', 'invalid_reservation_permission');
  // Sales calls and reading incoming calls are separate, explicit permissions; neither follows from the other or from a phone grant.
  assert(input.allowSales === undefined || typeof input.allowSales === 'boolean', 'invalid_sales_permission');
  assert(input.readInbound === undefined || typeof input.readInbound === 'boolean', 'invalid_inbound_permission');
  const grant = { id: randomUUID(), owner: owner.id, agentId: agent.id, team: owner.team, phones, maxCalls, maxTotalUsd, maxCallUsd, maxSeconds, expiresAt,
    allowReservation: input.allowReservation === true, allowSales: input.allowSales === true, readInbound: input.readInbound === true, budgetBasis: 'configured_cost_ceiling', consentVersion: service.config.consentVersion, status: 'ACTIVE', createdAt: service.store.now() };
  service.store.put('phone-grant', grant); service.store.audit(owner.id,'agent_phone.granted',grant.id,{agent:agent.id,maxCalls,maxTotalUsd,maxCallUsd,maxSeconds,expiresAt,allowSales:grant.allowSales,readInbound:grant.readInbound});
  return grant;
}
export function revokePhoneGrant(service, owner, id) {
  service.write(owner); const grant = service.own('phone-grant', id, owner);
  grant.status = 'REVOKED'; service.store.put('phone-grant',grant); service.store.audit(owner.id,'agent_phone.revoked',id);
  return grant; // queued calls are rechecked by the worker; already active calls must be cancelled explicitly.
}
function liveGrant(service, agent, grantId) {
  assert(agent.role === 'agent', 'agent_identity_required', 403);
  const grant = service.store.get('phone-grant',grantId);
  assert(grant && grant.agentId === agent.id && grant.team === agent.team, 'phone_grant_not_found', 404);
  assert(grant.status === 'ACTIVE' && grant.expiresAt > service.store.now(), 'phone_grant_expired_or_revoked', 403);
  const owner = service.user(grant.owner); service.write(owner);
  assert(owner.team === agent.team && grant.consentVersion === service.config.consentVersion && service.account(owner).consentVersion === service.config.consentVersion, 'phone_grant_scope_changed', 403);
  return {grant, owner};
}
export function checkPhoneDelegation(service, m) {
  if (!m.delegation) return;
  const { grant } = liveGrant(service, service.user(m.delegation.agentId), m.delegation.grantId);
  // A sales mission has no phoneRequest; it needs the sales permission instead, rechecked at claim time like the rest.
  const allowed = m.kind === 'phone-request' ? (!m.phoneRequest.task || grant.allowReservation) : grant.allowSales === true;
  assert(grant.owner === m.owner && grant.phones.includes(m.target.phone) && m.maxSeconds <= grant.maxSeconds && m.maxUsd <= grant.maxCallUsd && allowed, 'phone_grant_scope_changed', 403);
}
function ownedDispatch(service, agent, key) {
  assert(agent.role === 'agent', 'agent_identity_required',403);
  const dispatch = service.store.get('phone-dispatch',keyOf(agent,key));
  assert(dispatch && dispatch.owner === agent.id, 'phone_dispatch_not_found',404);
  const m = service.store.get('mission',dispatch.missionId);
  assert(m && m.delegation?.agentId === agent.id, 'phone_record_expired',410);
  // Status and stop remain accessible after grant expiry/revocation, only to the initiating identity.
  return m;
}
export function agentPhoneResult(service,m) {
  const done = terminal(m.status) && m.status !== 'UNKNOWN' && !m.stopNeedsReconciliation;
  return { schemaVersion:1, missionId:m.id, state:m.status, terminal:done,
    outcome:m.status === 'UNKNOWN' || m.stopNeedsReconciliation ? 'unknown' : !done ? 'pending' : m.status === 'COMPLETED' ? 'succeeded' : m.status === 'DECLINED' ? 'declined' : m.status === 'FAILED' ? 'failed' : m.status === 'CANCELLED' ? 'cancelled' : 'needs_review',
    successCriteria:m.phoneRequest?.success ?? null, result:m.result, record:m.kind === 'phone-request' ? phoneRecord(service,m) : salesRecord(service,m),
    nextAction:m.status === 'UNKNOWN' || m.stopNeedsReconciliation ? 'reconcile_with_operator_do_not_redial' : !done ? 'check_status' : m.status === 'COMPLETED' ? 'continue' : 'review_result_do_not_redial' };
}
export function dispatchPhone(service,agent,input,key) {
  object(input,['grantId','request']);
  const dispatchId = keyOf(agent,key), fingerprint = hash(canonical(input));
  assert(agent.role === 'agent','agent_identity_required',403);
  return service.store.tx(() => {
    const old = service.store.get('phone-dispatch',dispatchId);
    if (old) { assert(old.fingerprint === fingerprint,'idempotency_conflict',409); return agentPhoneResult(service,ownedDispatch(service,agent,key)); }
    if (service.store.get('phone-dispatch-cancel',dispatchId)) return cancelledBeforeDispatch();
    const {grant,owner} = liveGrant(service,agent,input.grantId);
    const request = preparePhoneRequest(input.request);
    assert(grant.phones.includes(request.phone),'recipient_not_delegated',403);
    assert(!request.task || grant.allowReservation,'reservation_not_delegated',403);
    if (request.task === 'reservation') assert(request.success?.expected.date && request.success?.expected.time && request.success?.expected.partySize && request.callerName,'reservation_requires_exact_conditions');
    const used = service.store.all('phone-dispatch',agent.id).filter(d => d.grantId === grant.id);
    assert(used.length < grant.maxCalls,'phone_grant_call_limit',429);
    const m = prepareManagedPhone(service,owner,input.request,{maxSeconds:grant.maxSeconds,maxUsd:grant.maxCallUsd});
    assert(m.estimatedMaximumUsd <= m.maxUsd,'estimated_cost_exceeds_grant',409);
    assert(used.reduce((n,d)=>n+d.reservedUsd,0)+m.maxUsd <= grant.maxTotalUsd+1e-9,'phone_grant_budget_exceeded',429);
    m.delegation = {agentId:agent.id,grantId:grant.id};
    service.store.put('mission',m);
    const {approvalToken} = service.review(owner,m.id);
    service.startTx(owner,approvalToken,`agent:${dispatchId}`,true,m.id);
    service.store.put('phone-dispatch',{id:dispatchId,owner:agent.id,grantId:grant.id,missionId:m.id,fingerprint,reservedUsd:m.maxUsd,createdAt:service.store.now()});
    service.store.audit(owner.id,'agent_phone.dispatched',m.id,{agent:agent.id,grant:grant.id,mission:m.id});
    return agentPhoneResult(service,service.own('mission',m.id,owner));
  });
}
export function readAgentPhone(service,agent,key) {
  assert(agent.role === 'agent','agent_identity_required',403);
  if (service.store.get('phone-dispatch-cancel',keyOf(agent,key))) return cancelledBeforeDispatch();
  return agentPhoneResult(service,ownedDispatch(service,agent,key));
}
export function cancelAgentPhone(service,agent,key) {
  assert(agent.role === 'agent','agent_identity_required',403);
  const id = keyOf(agent,key);
  // A stop may race an in-flight submit. Tombstone the operation before its draft exists as well.
  if (!service.store.get('phone-dispatch',id)) {
    service.store.put('phone-dispatch-cancel',{id,owner:agent.id,createdAt:service.store.now()});
    return cancelledBeforeDispatch();
  }
  const m = ownedDispatch(service,agent,key), owner = service.user(m.owner);
  service.cancel(owner,m.id); return agentPhoneResult(service,service.store.get('mission',m.id));
}

/** What an agent may read of a sales call: whom, about what, and the finalized words. The transcript is data, never instructions. */
function salesRecord(service,m) {
  const transcript = m.transcript ?? service.store.events(m.id,m.owner).filter(e=>e.type==='transcript.final').map(e=>({id:e.turnId,source:e.source,text:e.text,t:e.t}));
  return {id:m.id,direction:'outbound',kind:'sales',goal:m.goal,target:{name:m.target.name},product:m.product?{name:m.product.name}:null,request:m.request,transcript};
}

/** The products and delegated, permitted contacts a sales call can use. Reading never dials. */
export function agentSalesContext(service, agent, grantId) {
  const {grant, owner} = liveGrant(service, agent, grantId);
  assert(grant.allowSales === true, 'sales_not_delegated', 403);
  return {schemaVersion:1,
    products:service.store.list('product',owner.id).map(p=>({id:p.id,name:p.name})),
    // Only people in the grant are listed; anyone else is out of scope whatever their relationship.
    contacts:service.store.list('contact',owner.id).filter(c=>c.phone && grant.phones.includes(c.phone)).map(c=>({id:c.id,name:c.name,company:c.company??null,callPermitted:salesPermitted(service,owner,c)})),
    caveat:'会話上の合意と商談成立は別です。相手が断った・連絡を望まない場合はかけ直しません。'};
}

/**
 * One sales call inside the grant, approved per call by the person in the agent's own product (Genie's approval card).
 * The owner's grant with allowSales is the standing authorization this relies on; without it nothing is drafted.
 */
export function dispatchSales(service, agent, input, key) {
  object(input,['grantId','sales']);
  object(input.sales,['contactId','productId','request','goal','candidateSlots','maxSeconds']);
  const dispatchId = keyOf(agent,key), fingerprint = hash(canonical(input));
  assert(agent.role === 'agent','agent_identity_required',403);
  return service.store.tx(() => {
    const old = service.store.get('phone-dispatch',dispatchId);
    if (old) { assert(old.fingerprint === fingerprint,'idempotency_conflict',409); return agentPhoneResult(service,ownedDispatch(service,agent,key)); }
    if (service.store.get('phone-dispatch-cancel',dispatchId)) return cancelledBeforeDispatch();
    const {grant,owner} = liveGrant(service,agent,input.grantId);
    assert(grant.allowSales === true,'sales_not_delegated',403);
    const s = input.sales;
    assert(typeof s.contactId === 'string' && typeof s.request === 'string' && s.request.trim().length > 0 && s.request.length <= 2000,'invalid_sales_request');
    assert(s.goal === undefined || ['meeting','materials','introduce'].includes(s.goal),'invalid_goal');
    const contact = service.own('contact',s.contactId,owner);
    assert(grant.phones.includes(contact.phone),'recipient_not_delegated',403);
    assert(salesPermitted(service,owner,contact),'contact_permission_required',403);
    const used = service.store.all('phone-dispatch',agent.id).filter(d => d.grantId === grant.id);
    assert(used.length < grant.maxCalls,'phone_grant_call_limit',429);
    const maxSeconds = s.maxSeconds ?? Math.min(180,grant.maxSeconds);
    assert(Number.isInteger(maxSeconds) && maxSeconds >= 30 && maxSeconds <= grant.maxSeconds,'invalid_grant_duration');
    const m = service.prepare(owner,{contactId:contact.id,request:s.request,maxSeconds,maxUsd:grant.maxCallUsd,
      ...(s.productId?{productId:s.productId}:{}),...(s.goal?{goal:s.goal}:{}),...(s.candidateSlots?{candidateSlots:s.candidateSlots}:{})},{channel:'agent',agentId:agent.id},null,true,true);
    assert(m.target.id === contact.id && m.target.phone === contact.phone && !m.testOnMe,'contact_must_match_sales_draft',409);
    assert(used.reduce((n,d)=>n+d.reservedUsd,0)+m.maxUsd <= grant.maxTotalUsd+1e-9,'phone_grant_budget_exceeded',429);
    m.delegation = {agentId:agent.id,grantId:grant.id};
    service.store.put('mission',m);
    const {approvalToken} = service.review(owner,m.id);
    service.startTx(owner,approvalToken,`agent:${dispatchId}`,true,m.id);
    service.store.put('phone-dispatch',{id:dispatchId,owner:agent.id,grantId:grant.id,missionId:m.id,fingerprint,reservedUsd:m.maxUsd,createdAt:service.store.now()});
    service.store.audit(owner.id,'agent_sales.dispatched',m.id,{agent:agent.id,grant:grant.id,mission:m.id,goal:m.goal});
    return agentPhoneResult(service,service.own('mission',m.id,owner));
  });
}

/**
 * Finished incoming calls of the grant's owner, oldest first after a cursor. Needs readInbound on the grant.
 * `fromOwner` is true only when the caller id equals the owner's carrier-verified number: caller id can be spoofed,
 * so it marks whose request this probably is, never an approval.
 */
export function agentInbound(service, agent, grantId, after = 0) {
  const {grant, owner} = liveGrant(service, agent, grantId);
  assert(grant.readInbound === true, 'inbound_not_delegated', 403);
  const since = Number(after);
  assert(Number.isSafeInteger(since) && since >= 0, 'invalid_cursor');
  const account = service.account(owner), verified = account.phoneVerificationProvider === 'twilio-verify' ? account.verifiedPhone : null;
  const at = m => m.finishedAt ?? m.createdAt;
  const all = service.store.all('mission',owner.id).filter(m => m.direction === 'inbound' && terminal(m.status) && m.status !== 'UNKNOWN' && at(m) > since).sort((a,b) => at(a) - at(b));
  // The cursor is a time: a page never ends inside one millisecond, or the rest of that millisecond would be skipped.
  const calls = all.slice(0,50);
  while (calls.length < all.length && at(all[calls.length]) === at(calls.at(-1))) calls.push(all[calls.length]);
  return {schemaVersion:1,
    calls:calls.map(m => {
      const record = phoneRecord(service,m);
      return {callId:m.id,finishedAt:new Date(m.finishedAt ?? m.createdAt).toISOString(),state:m.status,from:m.target.phone,name:m.target.name,
        fromOwner:verified !== null && m.target.phone === verified,reception:m.inbound?.reception === true,transcript:record.transcript};
    }),
    next:calls.length ? at(calls.at(-1)) : since};
}
