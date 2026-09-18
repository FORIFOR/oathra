import { randomUUID } from 'node:crypto';
import { assert, hash, jsonFetch, signature, text } from './security.mjs';
import { reviewText } from './service.mjs';

export class Channels {
  constructor(service, env = process.env) { this.service = service; this.store = service.store; this.env = env; }
  receive(kind, raw, headers) {
    const secret = kind === 'line' ? this.env.LINE_CHANNEL_SECRET : this.env.SLACK_SIGNING_SECRET;
    assert(secret, 'channel_not_configured', 503); assert(signature(kind, raw, headers, secret, this.store.now()), 'invalid_webhook_signature', 401);
    let data;
    try { data = kind === 'slack' && !String(headers['content-type']).includes('application/json') ? Object.fromEntries(new URLSearchParams(raw.toString())) : JSON.parse(raw); if (data.payload) data = JSON.parse(data.payload); }
    catch { assert(false, 'invalid_webhook_json'); }
    if (kind === 'slack' && data.type === 'url_verification') return { challenge: text(data.challenge, 200) };
    const events = kind === 'line' ? data.events : [data]; assert(Array.isArray(events) && events.length <= 100, 'invalid_webhook_events');
    this.store.tx(() => {
      for (const e of events) {
        if (kind === 'line' && (e.source?.type !== 'user' || typeof e.webhookEventId !== 'string')) continue;
        if (kind === 'line' && (!Number.isFinite(e.timestamp) || e.timestamp > this.store.now() + 300_000 || e.timestamp < this.store.now() - 86400_000)) continue;
        const id = `${kind}:${kind === 'line' ? e.webhookEventId : e.event_id ?? hash(raw)}`;
        this.store.enqueue('inbox', id, '_channel', { kind, event: e });
      }
    });
    return { ok: true };
  }
  async process(job) {
    const { kind, event: e } = job.payload;
    const actor = kind === 'line' ? e.source.userId : `${e.team_id ?? e.team?.id}:${e.user?.id ?? e.event?.user ?? e.user_id}`;
    const destination = kind === 'line' ? actor : e.channel?.id ?? e.event?.channel ?? e.channel_id;
    if (kind === 'slack' && e.type !== 'block_actions' && e.event?.channel_type !== 'im' && e.channel_name !== 'directmessage') return;
    if (kind === 'slack' && (e.event?.bot_id || e.event?.subtype)) return;
    const origin = { channel: kind, actor, destination };
    let message = kind === 'line' ? e.message?.type === 'text' ? e.message.text : '' : e.event?.text ?? e.text ?? '';
    const binding = message.trim().match(/^(?:連携|link)\s+([\w-]{40,100})$/i);
    if (binding) {
      const u = this.service.link(kind, actor, binding[1]);
      this.store.enqueue('outbox', `${job.id}:linked`, u.id, { ...origin, text: '連携しました。登録済みの相手と商品を指定して依頼してください。メッセージだけでは発信しません。', buttons: [] }); return;
    }
    let u;
    try { u = this.service.channelUser(kind, actor); }
    catch { return; } // Do not spam unknown accounts or expose account existence.
    if (kind === 'line' && e.type === 'unfollow') { this.store.delKey('identity:line', actor); return; }
    if (kind === 'line' && e.type === 'unsend') {
      for (const m of this.store.list('mission', u.id)) if (m.sourceMessageId === e.unsend?.messageId) {
        this.service.cancel(u,m.id); if (['CANCELLED','DRAFT'].includes(this.store.get('mission',m.id)?.status)) this.store.removeMission(m);
      } return;
    }
    try {
      if (kind === 'line' && e.message?.type === 'audio') message = await this.transcribe(u, e.message);
      const buttonData = kind === 'line' ? e.postback?.data : e.actions?.[0]?.value;
      if (buttonData) {
        const p = new URLSearchParams(buttonData), token = p.get('token');
        if (p.get('action') === 'start') {
          const m = this.service.start(u, token, `channel:${hash(token ?? '')}`, true);
          this.service.notify(m, '発信を受け付けました。中止する場合は詳細画面から停止できます。');
        } else if (p.get('action') === 'cancel') {
          const { m } = this.service.validGrant(u, token, 'cancel'); this.service.cancel(u, m.id);
        }
        return;
      }
      if (!message.trim()) return;
      let m;
      if (/^(?:変更|修正)\s/.test(message)) {
        const drafts = this.store.list('mission',u.id,'DRAFT'); assert(drafts.length === 1,'select_one_draft_in_web');
        m = this.service.edit(u,drafts[0].id,{ request: message.replace(/^(?:変更|修正)\s+/, '') });
      } else m = this.service.prepare(u, { request: message }, origin, job.id);
      if (kind === 'line') { m.sourceMessageId = e.message?.id; this.store.put('mission',m); }
      const approval = this.service.review(u,m.id);
      const buttons = [
        { label: '確認して発信', data: new URLSearchParams({ action:'start',token:approval.approvalToken }).toString() },
        { label: 'キャンセル', data: new URLSearchParams({ action:'cancel',token:this.service.grant(u,m,'cancel') }).toString() },
      ];
      this.store.enqueue('outbox', `${job.id}:review`, u.id, { ...origin, missionId:m.id, text: reviewText(m), buttons });
    } catch (error) {
      const help = { select_one_contact:'Webで連絡先を登録し、相手の名前を1人だけ指定してください。', select_one_reviewed_product:'Webで商品情報を登録・確認してください。', verify_your_phone_first:'Webで自分の電話番号を確認してください。', privacy_consent_required:'Webでデータの送信先と利用目的を確認して同意してください。', recipient_suppressed:'この相手は再連絡停止になっています。', approval_expired_or_used:'承認が期限切れ、または使用済みです。詳細画面で実行状況を確認してください。' };
      this.store.enqueue('outbox', `${job.id}:error`, u.id, { ...origin, text: help[error.code] ?? `処理を進められませんでした（${error.code ?? 'internal_error'}）。詳細画面で確認してください。`, buttons:[] });
    }
  }
  async transcribe(u, message) {
    assert(this.service.account(u).consentVersion === this.service.config.consentVersion, 'privacy_consent_required',403);
    assert(this.env.OPENAI_API_KEY && this.env.LINE_CHANNEL_ACCESS_TOKEN, 'audio_transcription_not_configured',503);
    assert(/^\d{1,30}$/.test(message.id) && Number(message.duration) > 0 && Number(message.duration) <= 60_000, 'audio_must_be_under_60_seconds');
    const res = await fetch(`https://api-data.line.me/v2/bot/message/${message.id}/content`, { headers:{ authorization:`Bearer ${this.env.LINE_CHANNEL_ACCESS_TOKEN}` }, signal:AbortSignal.timeout(12_000) });
    assert(res.ok, 'audio_download_failed',502);
    const reader = res.body.getReader(), chunks = []; let length = 0;
    for (;;) { const { done,value } = await reader.read(); if (done) break; length += value.length; if (length > 8_000_000) { await reader.cancel(); throw new Error('audio_too_large'); } chunks.push(value); }
    const form = new FormData(); form.set('file',new Blob(chunks,{type:'audio/mp4'}),'voice.m4a'); form.set('model',this.env.OATHRA_TRANSCRIBE_MODEL ?? 'gpt-4o-mini-transcribe'); form.set('language','ja');
    const data = await jsonFetch('https://api.openai.com/v1/audio/transcriptions',{ method:'POST',headers:{authorization:`Bearer ${this.env.OPENAI_API_KEY}`},body:form });
    return text(data.text,2000);
  }
  async send(job) {
    const p = job.payload;
    if (p.channel === 'line') {
      assert(this.env.LINE_CHANNEL_ACCESS_TOKEN,'line_token_missing',503);
      if (!job.retryKey) { job.retryKey = randomUUID(); this.store.put('outbox',job); }
      const message = { type:'text',text:p.text.slice(0,4900), ...(p.buttons?.length ? {quickReply:{items:p.buttons.map(b => ({type:'action',action:{type:'postback',label:b.label.slice(0,20),data:b.data}}))}} : {}) };
      const res = await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{authorization:`Bearer ${this.env.LINE_CHANNEL_ACCESS_TOKEN}`,'content-type':'application/json','X-Line-Retry-Key':job.retryKey},body:JSON.stringify({to:p.destination,messages:[message]}),signal:AbortSignal.timeout(12_000)});
      assert(res.ok || (res.status === 409 && res.headers.has('x-line-accepted-request-id')),'line_send_failed',502);
    } else if (p.channel === 'slack') {
      assert(this.env.SLACK_BOT_TOKEN,'slack_token_missing',503);
      const blocks = [{type:'section',text:{type:'plain_text',text:p.text.slice(0,2900)}}];
      if(p.buttons?.length) blocks.push({type:'actions',elements:p.buttons.map(b => ({type:'button',text:{type:'plain_text',text:b.label},action_id:`oathra_${b.label}`,value:b.data}))});
      const data = await jsonFetch('https://slack.com/api/chat.postMessage',{method:'POST',headers:{authorization:`Bearer ${this.env.SLACK_BOT_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({channel:p.destination,text:p.text.slice(0,2900),blocks})});
      assert(data.ok,'slack_send_failed',502);
    }
  }
}
