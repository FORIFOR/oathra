import { randomUUID } from 'node:crypto';
import { assert, Fault, hash, jsonFetch, text } from './security.mjs';

/** External writes have their own immutable preview and approval. Unknown delivery is never retried automatically. */
export class Followups {
  constructor(service, env = process.env, fetchImpl = fetch) { this.service=service; this.store=service.store; this.env=env; this.fetchImpl=fetchImpl; }
  available(u) {
    if (u.id !== this.env.OATHRA_INTEGRATION_OWNER) return [];
    return [this.env.GOOGLE_REFRESH_TOKEN && this.env.GOOGLE_CLIENT_ID && this.env.GOOGLE_CLIENT_SECRET ? ['email','calendar'] : [], this.env.HUBSPOT_ACCESS_TOKEN ? ['crm'] : [], this.env.OATHRA_SMS_ENABLED === 'true' && this.env.TWILIO_AUTH_TOKEN ? ['sms'] : []].flat();
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
    const m=this.service.own('mission',missionId,u),kind=input.kind;
    assert(['email','calendar','crm','sms'].includes(kind),'invalid_followup_kind');
    const c=this.policy(u,m,kind),id=randomUUID(); let details;
    if(kind==='email' || kind==='sms') {
      assert(m.result?.verified?.material_send_allowed===true || !!m.result?.verified?.meeting_agreed_on_call,'contact_permission_not_in_call_evidence',403);
      // Permission to email does not imply SMS permission: the operator reviews the specific channel basis too.
      const basis=text(input.contactPermissionBasis,1000);
      details={recipient:kind==='email'?c.email:c.phone,body:text(input.body,kind==='sms'?500:12000),subject:kind==='email'?text(input.subject,150):'',contactPermissionBasis:basis};
      assert(details.recipient,'contact_email_required');
      if(kind==='sms') details.chargeNotice='SMS通信料が別途発生します。通話の費用上限には含みません。';
    } else if(kind==='calendar') {
      const start=m.result?.verified?.meeting_agreed_on_call; assert(start && Date.parse(start)>this.store.now(),'future_meeting_agreement_required',409);
      assert(c.email,'contact_email_required');
      const minutes=Number(input.minutes??15); assert(Number.isInteger(minutes)&&minutes>=5&&minutes<=120,'invalid_meeting_duration');
      details={recipient:c.email,title:text(input.title??`${m.product.name} 打ち合わせ`,150),start,end:new Date(Date.parse(start)+minutes*60000).toISOString(),minutes,
        note:'日時は電話で合意。所要時間は送信者が指定した招待内容です。招待承諾はまだ確認していません。'};
    } else {
      assert(/^\d+$/.test(c.crmId??''),'registered_crm_contact_id_required');
      details={recipient:c.crmId,body:text(input.body,12000)};
    }
    const action={id,owner:u.id,missionId:m.id,kind,details,status:'PREVIEW',createdAt:this.store.now(),missionFingerprint:this.service.fingerprint(m),expiresAt:this.store.now()+300000};
    action.approvalToken=this.service.grant(u,m,'followup',{followupId:id,payloadHash:hash(JSON.stringify(details))});
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
    const c=this.policy(u,m,action.kind);
    assert(action.details.recipient===(action.kind==='crm'?c.crmId:action.kind==='sms'?c.phone:c.email),'recipient_changed_review_again',409);
    // Access-token refresh is not an external user-visible write and occurs before reserving the send.
    const bearer=['email','calendar'].includes(action.kind)?await this.googleToken():null;
    this.store.tx(()=>{
      // Recheck after the token refresh; concurrent requests must not send twice.
      action=this.service.own('followup',id,u);assert(action.status==='PREVIEW','followup_already_executing',409);
      this.service.validGrant(u,input.approvalToken,'followup');const currentContact=this.policy(u,this.service.own('mission',m.id,u),action.kind);
      assert(action.details.recipient===(action.kind==='crm'?currentContact.crmId:action.kind==='sms'?currentContact.phone:currentContact.email),'recipient_changed_review_again',409);
      action.status='EXECUTING';this.store.put('followup',action);this.store.delKey('approval',tokenHash);this.store.setKey(`followup:${u.id}`,key,requestHash);this.store.audit(u.id,'followup.approved',id);
    });
    try {
      const response=await this.send(action,bearer);
      action.status='SUBMITTED';action.providerId=response.id??response.sid??null; action.submittedAt=this.store.now();
      action.delivery='Provider accepted the request; recipient receipt, reading, and acceptance are not established.';
      if(action.kind==='calendar')action.attendeeResponse='needsAction';
    } catch(error) { action.status=error.definitive?'REJECTED':'UNKNOWN';action.error='delivery_requires_provider_reconciliation'; }
    this.store.put('followup',action);return action;
  }
  async send(a,bearer) {
    const d=a.details; let url,init;
    if(a.kind==='email') {
      const subject=Buffer.from(d.subject).toString('base64');
      const raw=Buffer.from(`To: ${d.recipient}\r\nSubject: =?UTF-8?B?${subject}?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\nMessage-ID: <${a.id}@oathra.invalid>\r\n\r\n${Buffer.from(d.body).toString('base64').match(/.{1,76}/g).join('\r\n')}\r\n`).toString('base64url');
      url='https://gmail.googleapis.com/gmail/v1/users/me/messages/send';init={headers:{authorization:`Bearer ${bearer}`,'content-type':'application/json'},body:JSON.stringify({raw})};
    } else if(a.kind==='calendar') {
      url=`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.env.GOOGLE_CALENDAR_ID??'primary')}/events?sendUpdates=all`;
      init={headers:{authorization:`Bearer ${bearer}`,'content-type':'application/json'},body:JSON.stringify({id:a.id.replaceAll('-',''),summary:d.title,start:{dateTime:d.start},end:{dateTime:d.end},attendees:[{email:d.recipient,responseStatus:'needsAction'}],description:d.note,extendedProperties:{private:{oathraMission:a.missionId}}})};
    } else if(a.kind==='crm') {
      url='https://api.hubapi.com/crm/v3/objects/notes';
      const escaped=d.body.replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
      init={headers:{authorization:`Bearer ${this.env.HUBSPOT_ACCESS_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({properties:{hs_timestamp:new Date().toISOString(),hs_note_body:escaped},associations:[{to:{id:d.recipient},types:[{associationCategory:'HUBSPOT_DEFINED',associationTypeId:202}]}]})};
    } else {
      url=`https://api.twilio.com/2010-04-01/Accounts/${this.env.TWILIO_ACCOUNT_SID}/Messages.json`;
      init={headers:{authorization:'Basic '+Buffer.from(`${this.env.TWILIO_ACCOUNT_SID}:${this.env.TWILIO_AUTH_TOKEN}`).toString('base64'),'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({From:this.env.TWILIO_PHONE_NUMBER,To:d.recipient,Body:d.body})};
    }
    const response=await this.fetchImpl(url,{...init,method:'POST',signal:AbortSignal.timeout(12000),redirect:'error'});
    if(!response.ok){const e=new Fault(502,'followup_provider_error');e.definitive=response.status>=400&&response.status<500&&response.status!==408;throw e;}
    return response.json();
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
