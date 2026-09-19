import { randomUUID } from 'node:crypto';
import { assert, hash, text } from './security.mjs';
import { reviewText } from './service.mjs';
import { builtinRegistry } from './plugins.mjs';
import { freezeData, jsonData } from '../../../sdk/plugin-kit/index.mjs';

/** Policy and durable processing are shared; channel plugins own only protocol translation. */
export class Channels {
  constructor(service, env=process.env, registry=builtinRegistry(env,{now:()=>service.store.now()}), fetchImpl=fetch) {
    this.service=service;this.store=service.store;this.env=env;this.registry=registry;this.fetchImpl=fetchImpl;
  }
  has(kind) { return this.registry.has(kind,'channel'); }
  event(e) {
    assert(e && typeof e==='object'&&!Array.isArray(e),'invalid_channel_event');
    for(const k of ['eventId','actor','destination'])text(e[k],200);
    assert(['message','action','unlink','unsend'].includes(e.type),'invalid_channel_event');
    if(e.text!==undefined)assert(typeof e.text==='string'&&e.text.length<=2000,'invalid_channel_text');
    if(e.action!==undefined||e.type==='action')text(e.action,1000);
    if(e.type==='unsend')text(e.sourceMessageId,200);
    if(e.ackId!==undefined)text(e.ackId,200);
    if(e.sourceMessageId!==undefined)text(e.sourceMessageId,200);
    if(e.media!==undefined)assert(e.media&&typeof e.media.id==='string'&&e.media.id.length<=200&&Number.isFinite(e.media.duration)&&e.media.duration>0&&e.media.duration<=60000,'invalid_channel_media');
    return jsonData(e,8000);
  }
  receive(kind, raw, headers) {
    const adapter=this.registry.channel(kind);
    assert(Buffer.isBuffer(raw)&&raw.length<=262144,'request_too_large',413);
    assert(adapter.verify(raw,headers)===true,'invalid_webhook_signature',401);
    let decoded;try{decoded=adapter.decode(raw,headers);}catch(error){if(error.code)throw error;assert(false,'invalid_webhook_json');}
    assert(decoded&&Array.isArray(decoded.events)&&decoded.events.length<=100,'invalid_webhook_events');
    // Validate each event on its own: one oversized message must not discard someone else's approval in the same delivery.
    const events=decoded.events.flatMap(e=>{try{return [this.event(e)];}catch{return [];}})
      // Anyone can message the bot. Until an account is linked, the only thing worth queueing is a link code.
      .filter(e=>this.store.key(`identity:${kind}`,e.actor)||/^(?:連携|link)\s+[\w-]{40,100}$/i.test((e.text??'').trim()));
    this.store.tx(()=>{for(const event of events)this.store.enqueue('inbox',`${kind}:${event.eventId}`,'_channel',{kind,normalized:event,pluginIdentity:this.registry.identity(kind)},{priority:event.type==='action'});});
    return decoded.response?jsonData(decoded.response,4000):{ok:true};
  }
  async process(job) {
    const {kind}=job.payload,adapter=this.registry.channel(kind);
    // Old LINE/Slack inbox rows survive upgrades. Only built-ins supply legacyEvent.
    const value=job.payload.normalized??adapter.legacyEvent?.(job.payload.event);
    if(!value)return;const e=this.event(value);
    if(job.payload.pluginIdentity)assert(job.payload.pluginIdentity===this.registry.identity(kind),'plugin_changed_reissue_message',409);
    const {actor,destination}=e,origin={channel:kind,actor,destination,pluginIdentity:this.registry.identity(kind)};
    let message=e.text??'';
    const binding=message.trim().match(/^(?:連携|link)\s+([\w-]{40,100})$/i);
    if(binding){this.registry.demand(kind,'mission:draft');const u=this.service.link(kind,actor,binding[1]);this.reply(job,u,origin,'連携しました。登録済みの相手と商品を指定して依頼してください。メッセージだけでは発信しません。',[],'linked');return;}
    let u;try{u=this.service.channelUser(kind,actor);}catch{return;}
    if(e.type==='unlink'){this.store.delKey(`identity:${kind}`,actor);this.store.audit(u.id,'channel.unlinked',kind,{channel:kind});return;}
    if(e.type==='unsend'){
      for(const m of this.store.list('mission',u.id))if(m.origin?.channel===kind&&m.origin?.actor===actor&&m.sourceMessageId===e.sourceMessageId){
        this.service.cancel(u,m.id);if(['CANCELLED','DRAFT'].includes(this.store.get('mission',m.id)?.status))this.store.removeMission(m);
      }return;
    }
    try {
      if(e.media){this.registry.demand(kind,'media:transcribe');assert(this.service.account(u).consentVersion===this.service.config.consentVersion,'privacy_consent_required',403);assert(typeof adapter.transcribe==='function','audio_not_supported');message=text(await adapter.transcribe(freezeData(e.media)),2000);}
      if(e.type==='action'){
        if(e.ackId&&adapter.acknowledge)await adapter.acknowledge(freezeData(e)).catch(()=>{});
        let actionData=e.action;
        if(actionData?.startsWith('oa_')){const encoded=this.store.key(`channel-action:${kind}`,actionData);assert(encoded,'approval_expired_or_used',409);const a=this.store.open(encoded);assert(a.owner===u.id&&a.actor===actor&&a.destination===destination&&a.pluginIdentity===this.registry.identity(kind),'channel_approval_scope_mismatch',403);actionData=a.data;}
        this.registry.demand(kind,'approval:request');const params=new URLSearchParams(actionData),token=params.get('token'),action=params.get('action');
        assert(['start','cancel'].includes(action),'unsupported_channel_action');
        const previous=action==='start'?this.store.key(`start:${u.id}`,`channel:${hash(token??'')}`):null;
        if(previous){const old=this.service.own('mission',JSON.parse(previous).id,u);assert(old.origin?.channel===kind&&old.origin?.actor===actor,'channel_approval_scope_mismatch',403);return;}
        const {grant,m}=this.service.validGrant(u,token,action);
        assert(grant.channelIdentity===this.registry.identity(kind)&&grant.channel===kind&&grant.actor===actor&&grant.destination===destination,'channel_approval_scope_mismatch',403);
        assert(m.origin?.channel===kind&&m.origin?.actor===actor,'channel_approval_scope_mismatch',403);
        if(action==='start'){const started=this.service.start(u,token,`channel:${hash(token??'')}`,true);this.service.notify(started,'発信を受け付けました。中止する場合は詳細画面から停止できます。');}
        else {this.service.cancel(u,m.id);this.store.delKey('approval',hash(token));}
        return;
      }
      if(!message.trim())return;this.registry.demand(kind,'mission:draft');
      let m;
      if(/^(?:変更|修正)\s/.test(message)){
        const drafts=this.store.list('mission',u.id,'DRAFT').filter(m=>m.origin?.channel===kind&&m.origin?.actor===actor);
        assert(drafts.length===1,'select_one_draft_in_web');m=this.service.edit(u,drafts[0].id,{request:message.replace(/^(?:変更|修正)\s+/,'')});
      }else m=this.service.prepare(u,{request:message},origin,job.id);
      m.sourceMessageId=e.sourceMessageId;this.store.put('mission',m);
      this.registry.demand(kind,'mission:read');
      const scope={channel:kind,actor,destination,channelIdentity:this.registry.identity(kind)};
      const buttons=[];
      if(this.registry.allows(kind,'approval:request')){
        assert(m.status==='DRAFT','mission_already_started',409);
        buttons.push({label:'確認して発信',data:new URLSearchParams({action:'start',token:this.service.grant(u,m,'start',scope)}).toString()},
          {label:'キャンセル',data:new URLSearchParams({action:'cancel',token:this.service.grant(u,m,'cancel',scope)}).toString()});
      }
      this.reply(job,u,origin,reviewText(m),buttons,'review',m.id);
    }catch(error){
      const help={select_one_contact:'Webで連絡先を登録し、相手の名前を1人だけ指定してください。',select_one_reviewed_product:'Webで商品情報を登録・確認してください。',privacy_consent_required:'Webでデータの送信先と利用目的を確認して同意してください。',recipient_suppressed:'この相手は再連絡停止になっています。',approval_expired_or_used:'承認が期限切れ、または使用済みです。詳細画面で実行状況を確認してください。'};
      const code=/^[a-z_]{1,80}$/.test(error.code??'')?error.code:'internal_error';
      this.reply(job,u,origin,help[code]??`処理を進められませんでした（${code}）。詳細画面で確認してください。`,[],'error');
    }
  }
  reply(job,u,origin,message,buttons,suffix,missionId){this.store.enqueue('outbox',`${job.id}:${suffix}`,u.id,{...origin,...(missionId?{missionId}:{}),text:message,buttons});}
  async send(job){
    const p=job.payload,adapter=this.registry.channel(p.channel);
    if(p.missionId)this.registry.demand(p.channel,'mission:read');this.registry.demand(p.channel,'channel:send');
    // Unlinking immediately stops delivery of queued personal information.
    assert(this.service.channelUser(p.channel,p.actor).id===job.owner,'channel_delivery_owner_changed',403);
    if(p.pluginIdentity)assert(p.pluginIdentity===this.registry.identity(p.channel),'plugin_changed_reissue_message',409);
    if(!job.retryKey){job.retryKey=randomUUID();this.store.put('outbox',job);}
    const outgoing=jsonData(p);
    outgoing.buttons=(p.buttons??[]).map(b=>{const alias='oa_'+hash(job.retryKey+':'+b.data).slice(0,40);this.store.setKey(`channel-action:${p.channel}`,alias,this.store.seal({owner:job.owner,actor:p.actor,destination:p.destination,pluginIdentity:this.registry.identity(p.channel),data:b.data}),300000);return {...b,data:alias};});
    const result=await adapter.send(freezeData(outgoing),{retryKey:job.retryKey,signal:AbortSignal.timeout(12000),fetchImpl:this.fetchImpl});
    assert(result?.status==='accepted','channel_delivery_not_accepted',502);
  }
}
