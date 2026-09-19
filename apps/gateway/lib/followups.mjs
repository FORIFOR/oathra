import { randomUUID } from 'node:crypto';
import { builtinRegistry } from './plugins.mjs';
import { freezeData, jsonData } from '../../../sdk/plugin-kit/index.mjs';
import { assert, Fault, hash, jsonFetch, text } from './security.mjs';

/** External writes have their own immutable preview and approval. Unknown delivery is never retried automatically. */
export class Followups {
  constructor(service, env = process.env, fetchImpl = fetch, registry = builtinRegistry(env)) { this.service=service; this.store=service.store; this.env=env; this.fetchImpl=fetchImpl; this.registry=registry; }
  plugin(kind) { this.registry.demand(kind,'followup:execute'); return this.registry.get(kind,'capability'); }
  recipient(kind,c) { const effect=this.plugin(kind).manifest.effect; return effect==='crm'?c.crmId:effect==='sms'?c.phone:c.email; }
  available(u) {
    if (u.id !== this.env.OATHRA_INTEGRATION_OWNER) return [];
    return this.registry.list('capability').filter(p=>p.enabled&&p.configured&&p.effect!=='call').map(p=>p.id);
  }
  policy(u, m, kind) {
    this.service.write(u);
    assert(m.mode==='live' && ['COMPLETED','INCOMPLETE'].includes(m.status), 'finished_real_call_required',409);
    assert(!m.result?.doNotContact && !this.store.suppressed(u.team,m.target.phone),'recipient_suppressed',403);
    assert(this.service.account(u).consentVersion===this.service.config.consentVersion,'privacy_consent_required',403);
    assert(this.available(u).includes(kind),'integration_not_configured_for_this_account',503);
    assert(m.target.id!=='self','followup_requires_business_contact');
    const contact=this.service.own('contact',m.target.id,u);
    assert(contact.phone===m.target.phone,'contact_changed_review_again',409);
    return contact;
  }
  preview(u, missionId, input) {
    const m=this.service.own('mission',missionId,u),kind=input.kind,p=this.plugin(kind),effect=p.manifest.effect;
    const c=this.policy(u,m,kind),id=randomUUID();
    if(effect==='email'||effect==='sms') {
      assert(m.result?.verified?.material_send_allowed===true || !!m.result?.verified?.meeting_agreed_on_call,'contact_permission_not_in_call_evidence',403);
      text(input.contactPermissionBasis,1000);
    } else if(effect==='calendar') {
      assert(m.result?.verified?.meeting_agreed_on_call && Date.parse(m.result.verified.meeting_agreed_on_call)>this.store.now(),'future_meeting_agreement_required',409);
    } else assert(/^\d+$/.test(c.crmId??''),'registered_crm_contact_id_required');
    const recipient=this.recipient(kind,c);assert(recipient,'contact_email_required');
    const prepared=p.adapter.preview(freezeData(jsonData(input)),{mission:freezeData(jsonData(m)),contact:freezeData(jsonData(c)),now:this.store.now()});
    assert(prepared && typeof prepared==='object'&&!Array.isArray(prepared)&&typeof prepared.then!=='function','invalid_capability_preview');
    const details=jsonData(prepared,32000);
    assert(!Object.hasOwn(details,'recipient')||details.recipient===recipient,'plugin_cannot_replace_recipient',403);
    details.recipient=recipient;
    if(effect==='email'||effect==='sms')details.contactPermissionBasis=text(input.contactPermissionBasis,1000);
    if(effect==='calendar')assert(Date.parse(details.start)===Date.parse(m.result.verified.meeting_agreed_on_call)&&Date.parse(details.end)>Date.parse(details.start)&&Date.parse(details.end)-Date.parse(details.start)<=120*60000,'calendar_time_must_match_evidence');
    const pluginIdentity=p.identity;
    const action={id,owner:u.id,missionId:m.id,kind,effect,pluginIdentity,details,status:'PREVIEW',createdAt:this.store.now(),missionFingerprint:this.service.fingerprint(m),expiresAt:this.store.now()+300000};
    action.approvalToken=this.service.grant(u,m,'followup',{followupId:id,payloadHash:hash(JSON.stringify(details)),pluginIdentity});
    const {approvalToken,...stored}=action; this.store.put('followup',stored); return action;
  }
  async googleToken() {
    const r=await jsonFetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:this.env.GOOGLE_REFRESH_TOKEN,client_id:this.env.GOOGLE_CLIENT_ID,client_secret:this.env.GOOGLE_CLIENT_SECRET})});
    assert(typeof r.access_token==='string','google_authorization_failed',502);return r.access_token;
  }
  async execute(u,id,input,key) {
    this.service.write(u);assert(input.acknowledged===true,'explicit_followup_approval_required',403);text(key,150);
    let action=this.service.own('followup',id,u);const tokenHash=hash(text(input.approvalToken,200)),requestHash=hash(JSON.stringify([id,tokenHash]));
    const receipt=this.store.key(`followup:${u.id}`,key);
    if(receipt){assert(receipt===requestHash,'idempotency_conflict',409);return action;}
    assert(action.status==='PREVIEW' && action.expiresAt>this.store.now(),'followup_expired_or_used',409);
    const {grant,m}=this.service.validGrant(u,input.approvalToken,'followup');
    assert(grant.followupId===id && m.id===action.missionId && grant.payloadHash===hash(JSON.stringify(action.details)),'approval_scope_mismatch',403);
    assert(action.pluginIdentity===this.registry.identity(action.kind)&&grant.pluginIdentity===action.pluginIdentity,'plugin_changed_review_again',409);
    const c=this.policy(u,m,action.kind);
    assert(action.details.recipient===this.recipient(action.kind,c),'recipient_changed_review_again',409);
    // Access-token refresh is not an external user-visible write and occurs before reserving the send.
    const bearer=['email','calendar'].includes(action.kind)?await this.googleToken():null;
    this.store.tx(()=>{
      // Recheck after the token refresh; concurrent requests must not send twice.
      action=this.service.own('followup',id,u);assert(action.status==='PREVIEW','followup_already_executing',409);
      this.service.validGrant(u,input.approvalToken,'followup');const currentContact=this.policy(u,this.service.own('mission',m.id,u),action.kind);
      assert(action.details.recipient===this.recipient(action.kind,currentContact),'recipient_changed_review_again',409);
      assert(action.pluginIdentity===this.registry.identity(action.kind),'plugin_changed_review_again',409);
      action.status='EXECUTING';this.store.put('followup',action);this.store.delKey('approval',tokenHash);this.store.setKey(`followup:${u.id}`,key,requestHash);this.store.audit(u.id,'followup.approved',id);
    });
    try {
      const beforeSend=()=>{const current=this.policy(u,this.service.own('mission',action.missionId,u),action.kind);assert(action.details.recipient===this.recipient(action.kind,current),'recipient_changed_review_again',409);assert(action.pluginIdentity===this.registry.identity(action.kind),'plugin_changed_review_again',409);};
      beforeSend();
      const response=await this.send(freezeData(jsonData(action)),bearer,beforeSend);
      assert(response && (typeof response.id==='string'||typeof response.sid==='string'),'provider_receipt_missing',502);
      action.status='SUBMITTED';action.providerId=response.id??response.sid??null; action.submittedAt=this.store.now();
      action.delivery='Provider accepted the request; recipient receipt, reading, and acceptance are not established.';
      if(action.effect==='calendar')action.attendeeResponse='needsAction';
    } catch(error) { action.status=error.definitive?'REJECTED':'UNKNOWN';action.error='delivery_requires_provider_reconciliation'; }
    this.store.put('followup',action);
    this.store.audit(u.id,'followup.result',id,{followup:id,mission:action.missionId,kind:action.kind,effect:action.effect,status:action.status,providerId:action.providerId??null});return action;
  }
  async send(a,bearer,beforeSend) {
    const p=this.plugin(a.kind),abort=new AbortController();let timer;
    // A timeout means UNKNOWN. The adapter may have reached the provider; do not auto-retry.
    try { return await Promise.race([
      p.adapter.execute(freezeData(jsonData(a)),{bearer,fetchImpl:(...args)=>{beforeSend?.();return this.fetchImpl(...args);},signal:abort.signal}),
      new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(new Error('capability_timeout'));},12000);})
    ]); } finally {clearTimeout(timer);}
  }
  async refreshCalendar(u,id) {
    const a=this.service.own('followup',id,u);assert(a.kind==='calendar'&&a.providerId,'calendar_receipt_required');
    assert(this.available(u).includes('calendar'),'integration_not_configured_for_this_account',503);
    const bearer=await this.googleToken();const event=await jsonFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.env.GOOGLE_CALENDAR_ID??'primary')}/events/${encodeURIComponent(a.providerId)}`,{headers:{authorization:`Bearer ${bearer}`}});
    assert(event.extendedProperties?.private?.oathraMission===a.missionId,'external_record_mismatch',409);
    assert(Date.parse(event.start?.dateTime)===Date.parse(a.details.start)&&Date.parse(event.end?.dateTime)===Date.parse(a.details.end),'calendar_time_changed_not_same_agreement',409);
    a.attendeeResponse=event.attendees?.find(x=>x.email?.toLowerCase()===a.details.recipient.toLowerCase())?.responseStatus??'unknown';a.checkedAt=this.store.now();
    a.eventStatus=event.status;this.store.put('followup',a);return a;
  }
}
