import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../lib/store.mjs';
import { Service } from '../lib/service.mjs';
import { Channels } from '../lib/channels.mjs';
import { Worker, simulate } from '../lib/worker.mjs';
import { hash, signature, publicIPv4, issue, verify, twilioSignature, equal } from '../lib/security.mjs';
import { dateTime, evaluateSales } from '../lib/sales.mjs';
import { createGateway, configuration } from '../server.mjs';
const now=Date.parse('2026-09-19T03:00:00+09:00'), token='test-operator-token-'.repeat(3);
function fixture(){
  let clock=now;
  const config={mode:'simulator',users:[{id:'alice',team:'one',role:'admin',tokenHash:hash(token)},{id:'bob',team:'one',role:'operator',tokenHash:hash('bob')},{id:'viewer',team:'one',role:'viewer',tokenHash:hash('viewer')},{id:'agent',team:'one',role:'agent',tokenHash:hash('agent')}],maxSeconds:300,maxCallUsd:10,dailyCalls:20,dailyUsd:30,rateCeilingUsd:0.1,setupFeeUsd:0,consentVersion:'v1',liveReady:false,publicUrl:'http://localhost:4244',missing:[]};
  const store=new Store(':memory:',randomBytes(32).toString('hex'),()=>clock), service=new Service(store,config),u=config.users[0];
  service.saveConsent(u,'v1');store.put('account',{...service.account(u),verifiedPhone:'+15005550006',phoneVerificationProvider:'simulator'});
  const product=service.product(u,{name:'Example product',facts:'Only the reviewed feature.',reviewed:true});
  const contact=service.contact(u,{name:'田中さん',phone:'+819000000001',relationship:'inquiry',basis:'Customer requested a follow-up',email:'tanaka@example.test'});
  const draft=(overrides={})=>service.prepare(u,{request:'田中さんに商談を提案',contactId:contact.id,productId:product.id,...overrides});
  return {config,store,service,u,product,contact,draft,advance(ms){clock+=ms;},close(){store.close();}};
}
function withFixture(fn){return async()=>{const f=fixture();try{await fn(f);}finally{f.close();}};}
function approve(f,m,key='one'){const r=f.service.review(f.u,m.id);return f.service.start(f.u,r.approvalToken,key,true);}

test('LINE signatures are checked over the original bytes',()=>{const b=Buffer.from('{ "text": "日本語" }'),secret='line';const sig=createHmac('sha256',secret).update(b).digest('base64');assert(signature('line',b,{'x-line-signature':sig},secret,now));assert(!signature('line',Buffer.from('{"text":"日本語"}'),{'x-line-signature':sig},secret,now));assert(!signature('line',b,{'x-line-signature':sig},'',now));});
test('Slack accepts a current signature and rejects old timestamps',()=>{const b=Buffer.from('a=1'),secret='slack',ts=String(now/1000),headers={'x-slack-request-timestamp':ts,'x-slack-signature':'v0='+createHmac('sha256',secret).update(`v0:${ts}:`).update(b).digest('hex')};assert(signature('slack',b,headers,secret,now));assert(!signature('slack',b,headers,secret,now+301000));});
test('Twilio callbacks include URL and sorted fields in their signature',()=>{const url='https://gateway.test/hooks/x',params={Digits:'1',CallSid:'CA1'};const s=createHmac('sha1','secret').update(url+'CallSidCA1Digits1').digest('base64');assert(twilioSignature(url,params,s,'secret'));assert(!twilioSignature(url,{...params,Digits:'2'},s,'secret'));});
test('approval HMAC binds actor, expires, and rejects mutations',()=>{const t=issue('secret',{owner:'alice'},now);assert.equal(verify('secret',t,{owner:'alice'},now).owner,'alice');assert.throws(()=>verify('secret',t,{owner:'bob'},now));assert.throws(()=>verify('secret',t,{owner:'alice'},now+300001));assert.throws(()=>verify('secret',t+'x',{owner:'alice'},now));});
for(const ip of ['127.0.0.1','10.1.2.3','169.254.169.254','172.31.0.1','192.168.1.1','100.64.0.1','0.0.0.0','::1','::ffff:127.0.0.1','198.18.0.1','224.0.0.1'])test(`SSRF rejects ${ip}`,()=>assert(!publicIPv4(ip)));
test('SSRF permits a public IPv4',()=>assert(publicIPv4('93.184.216.34')));
test('encrypted store does not expose payload in database or WAL',()=>{const dir=mkdtempSync(join(tmpdir(),'oathra-')),path=join(dir,'db'),key=randomBytes(32).toString('hex');const store=new Store(path,key);store.put('mission',{id:'m',owner:'a',status:'DRAFT',secret:'sensitive-test-string-408'});assert.equal(store.get('mission','m').secret,'sensitive-test-string-408');for(const file of [path,path+'-wal'])assert(!readFileSync(file).includes(Buffer.from('sensitive-test-string-408')));store.close();rmSync(dir,{recursive:true});});
test('two workers cannot acquire the same lease',withFixture(f=>{assert(f.store.lease('one'));assert(!f.store.lease('two'));f.advance(31000);assert(f.store.lease('two'));}));
test('transactions roll back mission and audit writes together',withFixture(f=>{assert.throws(()=>f.store.tx(()=>{f.store.put('x',{id:'1',owner:'a'});throw Error('rollback');}));assert.equal(f.store.get('x','1'),null);}));
test('draft never enqueues a telephone call',withFixture(f=>{const m=f.draft();assert.equal(m.status,'DRAFT');assert.equal(f.store.list('mission',undefined,'QUEUED').length,0);}));
test('explicit approval is mandatory',withFixture(f=>{const m=f.draft(),r=f.service.review(f.u,m.id);assert.throws(()=>f.service.start(f.u,r.approvalToken,'one',false),/explicit_call/);assert.equal(f.store.get('mission',m.id).status,'DRAFT');}));
test('idempotent retry returns the same call after the token is consumed',withFixture(f=>{const m=f.draft(),r=f.service.review(f.u,m.id);const a=f.service.start(f.u,r.approvalToken,'same',true),b=f.service.start(f.u,r.approvalToken,'same',true);assert.equal(a.id,b.id);assert.equal(f.store.list('mission',undefined,'QUEUED').length,1);}));
test('a different idempotency key cannot reuse consumed approval',withFixture(f=>{const m=f.draft(),r=f.service.review(f.u,m.id);f.service.start(f.u,r.approvalToken,'same',true);assert.throws(()=>f.service.start(f.u,r.approvalToken,'different',true),/approval_expired_or_used/);}));
test('idempotency key cannot be repurposed for another mission',withFixture(f=>{const a=f.draft(),b=f.draft();approve(f,a,'same');const r=f.service.review(f.u,b.id);assert.throws(()=>f.service.start(f.u,r.approvalToken,'same',true),/idempotency_conflict/);}));
test('route mission must match the approval before any effect',withFixture(f=>{const a=f.draft(),b=f.draft(),r=f.service.review(f.u,a.id);assert.throws(()=>f.service.start(f.u,r.approvalToken,'one',true,b.id),/scope/);assert.equal(f.store.get('mission',a.id).status,'DRAFT');}));
test('editing invalidates the old approval',withFixture(f=>{const m=f.draft(),r=f.service.review(f.u,m.id);f.service.edit(f.u,m.id,{request:'別の目的'});assert.throws(()=>f.service.start(f.u,r.approvalToken,'one',true),/mission_changed/);}));
test('product revisions invalidate approval',withFixture(f=>{const m=f.draft(),r=f.service.review(f.u,m.id);f.service.product(f.u,{...f.product,facts:'Changed',reviewed:true});assert.throws(()=>f.service.start(f.u,r.approvalToken,'one',true),/product_changed/);}));
test('contact-number changes invalidate approval',withFixture(f=>{const m=f.draft(),r=f.service.review(f.u,m.id);f.service.contact(f.u,{...f.contact,phone:'+819000000002'});assert.throws(()=>f.service.start(f.u,r.approvalToken,'one',true),/contact_changed/);}));
test('expired approval is unusable',withFixture(f=>{const m=f.draft(),r=f.service.review(f.u,m.id);f.advance(300001);assert.throws(()=>f.service.start(f.u,r.approvalToken,'one',true),/expired/);}));
test('no cross-user reads or approvals',withFixture(f=>{const m=f.draft(),r=f.service.review(f.u,m.id),bob=f.service.user('bob');assert.throws(()=>f.service.own('mission',m.id,bob),/not_found/);assert.throws(()=>f.service.start(bob,r.approvalToken,'one',true),/scope/);}));
test('read-only and agent identities cannot approve',withFixture(f=>{assert.throws(()=>f.service.write(f.service.user('viewer')),/read_only/);assert.throws(()=>f.service.write(f.service.user('agent')),/read_only/);}));
test('suppression applies to the entire team, and to every other team using the same caller id',withFixture(f=>{f.store.suppress('one',f.contact.phone);assert(f.store.suppressed('one',f.contact.phone));assert(f.store.suppressed('two',f.contact.phone));assert(!f.store.suppressed('two','+819000000009'));assert.throws(()=>approve(f,f.draft()),/suppressed/);}));
test('revoked privacy consent prevents execution',withFixture(f=>{const m=f.draft();f.store.put('account',{...f.service.account(f.u),consentVersion:'old'});assert.throws(()=>approve(f,m),/privacy_consent/);}));
test('invalid budgets and unreviewed facts are rejected',withFixture(f=>{for(const maxSeconds of [0,-1,NaN,301,1.5])assert.throws(()=>f.draft({maxSeconds}));for(const maxUsd of [0,-1,NaN,11])assert.throws(()=>f.draft({maxUsd}));assert.throws(()=>f.service.product(f.u,{name:'x',facts:'x',reviewed:false}));}));
test('simulator approvals cannot cross into live mode',withFixture(f=>{const m=f.draft();f.config.mode='live';assert.throws(()=>approve(f,m),/configuration_changed/);}));
test('queued recipient is blocked from another simultaneous call',withFixture(f=>{approve(f,f.draft());assert.throws(()=>approve(f,f.draft(),'two'),/active_call/);}));
test('cancelling queued work has no execution side effect',withFixture(f=>{const m=approve(f,f.draft());assert.equal(f.service.cancel(f.u,m.id).status,'CANCELLED');}));
test('daily reservations enforce budget even without invoices',withFixture(f=>{f.config.dailyCalls=1;const m=approve(f,f.draft());f.service.cancel(f.u,m.id);assert.throws(()=>approve(f,f.draft(),'two'),/daily_limit/);}));
test('channel pairing is single-use and owner bound',withFixture(f=>{const code=f.service.linkCode(f.u);assert.equal(f.service.link('line','U1',code).id,'alice');assert.equal(f.service.channelUser('line','U1').id,'alice');assert.throws(()=>f.service.link('line','U2',code),/expired/);}));
test('LINE webhook duplicates are deduplicated before processing',withFixture(f=>{f.service.link('line','U1',f.service.linkCode(f.u));const c=new Channels(f.service,{LINE_CHANNEL_SECRET:'s'}),e={type:'message',webhookEventId:'evt1',timestamp:now,source:{type:'user',userId:'U1'},message:{type:'text',text:'hello'}};const raw=Buffer.from(JSON.stringify({events:[e]})),headers={'x-line-signature':createHmac('sha256','s').update(raw).digest('base64')};c.receive('line',raw,headers);c.receive('line',raw,headers);assert.equal(f.store.list('inbox').length,1);}));
test('LINE group input never becomes a call',withFixture(f=>{const c=new Channels(f.service,{LINE_CHANNEL_SECRET:'s'}),raw=Buffer.from(JSON.stringify({events:[{webhookEventId:'evt',timestamp:now,source:{type:'group',userId:'U1'}}]})),headers={'x-line-signature':createHmac('sha256','s').update(raw).digest('base64')};c.receive('line',raw,headers);assert.equal(f.store.list('inbox').length,0);}));
test('linked LINE request produces a review card, not a queued call',withFixture(async f=>{f.service.link('line','U1',f.service.linkCode(f.u));const c=new Channels(f.service,{});await c.process({id:'line:event1',payload:{kind:'line',event:{type:'message',source:{type:'user',userId:'U1'},message:{type:'text',id:'123',text:'田中さんに商談を提案'}}}});assert.equal(f.store.list('mission').length,1);assert.equal(f.store.list('mission')[0].status,'DRAFT');const out=f.store.list('outbox')[0];assert(out.payload.buttons[0].data.length<=300);}));
test('LINE approval end-to-end is single-shot under redelivery',withFixture(async f=>{f.service.link('line','U1',f.service.linkCode(f.u));const c=new Channels(f.service,{});await c.process({id:'line:event1',payload:{kind:'line',event:{source:{type:'user',userId:'U1'},message:{type:'text',text:'田中さんに商談を提案'}}}});const button=f.store.list('outbox')[0].payload.buttons[0].data;for(let i=0;i<2;i++)await c.process({id:'line:postback'+i,payload:{kind:'line',event:{type:'postback',source:{type:'user',userId:'U1'},postback:{data:button}}}});assert.equal(f.store.list('mission',undefined,'QUEUED').length,1);}));
const mission={goal:'meeting',candidateSlots:[]};
function evaluate(lines){return evaluateSales(lines.map((text,i)=>({id:'t'+i,source:'callee',text})),mission,true,now);}
for(const line of ['来週なら大丈夫かもしれません','9月25日15時ならたぶん大丈夫です','資料を送ってください','9月25日15時で仮押さえをお願いします','9月25日15時でお願いしますか？','9月25日15時は無理です'])test('not a meeting: '+line,()=>assert.notEqual(evaluate([line]).status,'COMPLETED'));
const proposal={id:'ask',source:'caller',text:'9月25日の15時から15分、商談のお時間をいただけますか。'};
const reply=text=>evaluateSales([proposal,{id:'reply',source:'callee',text}],mission,true,now);
test('full explicit date/time agreement is conversation evidence',()=>{const r=reply('はい、9月25日15時でお願いします');assert.equal(r.status,'COMPLETED');assert.equal(r.verified.meeting_agreed_on_call,'2026-09-25T15:00:00+09:00');const e=r.evidence.find(x=>x.field==='meeting_agreed_on_call');assert.equal(e.turn,'reply');assert.equal(e.source,'callee');assert.match(e.confirmedProposal,/商談/);});
test('a slot only the callee stated is not a meeting until the caller accepts it',()=>{assert.equal(evaluate(['9月25日15時でお願いします']).status,'INCOMPLETE');const r=evaluateSales([{id:'c',source:'callee',text:'9月25日15時でお願いします'},{id:'a',source:'caller',text:'承知しました。9月25日の15時でお願いします。'}],mission,true,now);assert.equal(r.verified.meeting_agreed_on_call,'2026-09-25T15:00:00+09:00');});
// Reported COMPLETED by the former gateway-local regex verdict (2026-09-19). The verdict now comes from packages/evidence.
for(const line of ['ご用件は承知しました。ただ9月25日の15時は別の会議が入っています。','9月25日の15時ですね、承知しました、上司に聞いてから折り返します。','9月25日の15時でお願いします、と言いたいところですが、その日は出張です。','9月25日の15時の件は承知しました。まずメールで詳細を送ってもらえますか。それから判断します。','9月25日の15時なあ、まあ大丈夫ですやろけど、約束はできまへんで。'])test('hedged or conflicting reply is not a meeting: '+line,()=>{const r=reply(line);assert.equal(r.status,'INCOMPLETE');assert.deepEqual(r.verified,{});});
test('「それで結構です」 accepts; a bare 「結構です」 declines',()=>{const yes=reply('はい、それで結構です。9月25日の15時でお願いします。');assert.equal(yes.status,'COMPLETED');assert.equal(yes.doNotContact,false);const no=reply('いえ、結構です。');assert.equal(no.status,'DECLINED');assert(no.doNotContact);});
test('a yes that is taken back in the next breath is not a meeting',()=>{for(const later of ['あ、すみません、その日は出張でした。','ええと、上司に聞いてからでないと決められません。'])assert.equal(evaluateSales([proposal,{id:'c1',source:'callee',text:'はい。'},{id:'c2',source:'callee',text:later}],mission,true,now).status,'INCOMPLETE');});
test('an agreed slot in the past is not a meeting',()=>assert.equal(evaluateSales([{id:'a',source:'caller',text:'9月10日の15時でいかがでしょうか。'},{id:'c',source:'callee',text:'はい、9月10日の15時でお願いします。'}],mission,true,now).status,'INCOMPLETE'));
test('the verdict needs a connected call',()=>assert.equal(evaluateSales([proposal,{id:'reply',source:'callee',text:'はい、9月25日15時でお願いします'}],mission,false,now).status,'INCOMPLETE'));
test('caller cannot certify their own success',()=>{assert.equal(evaluateSales([{source:'caller',text:'9月25日15時で確定です'}],mission,true,now).status,'INCOMPLETE');});
test('adjacent callee yes can confirm a fully restated meeting proposal',()=>assert.equal(evaluateSales([{source:'caller',text:'商談は9月25日15時でよろしいでしょうか？'},{source:'callee',text:'はい。'}],mission,true,now).status,'COMPLETED'));
test('confirmation followed by cancellation is not complete',()=>assert.equal(evaluateSales([proposal,{id:'c1',source:'callee',text:'はい、9月25日15時でお願いします'},{id:'c2',source:'callee',text:'やはりキャンセルしてください'}],mission,true,now).status,'INCOMPLETE'));
test('do not contact overrides all previous agreements',()=>{const r=evaluateSales([proposal,{id:'c1',source:'callee',text:'はい、9月25日15時でお願いします'},{id:'c2',source:'callee',text:'今後電話しないでください'}],mission,true,now);assert.equal(r.status,'DECLINED');assert(r.doNotContact);});
test('calendar candidate mismatch is incomplete',()=>{const turns=[proposal,{id:'reply',source:'callee',text:'はい、9月25日15時でお願いします'}];assert.equal(evaluateSales(turns,{...mission,candidateSlots:['2026-09-26T15:00:00+09:00']},true,now).status,'INCOMPLETE');assert.equal(evaluateSales(turns,{...mission,candidateSlots:['2026-09-25T15:00:00+09:00']},true,now).status,'COMPLETED');});
test('calendar overflow dates cannot be evidence',()=>assert.equal(dateTime('2026年9月31日15時でお願いします',now),null));
test('materials permission is not a meeting',()=>{const r=evaluate(['資料を送ってください']);assert.equal(r.verified.material_send_allowed,true);assert.equal(r.status,'INCOMPLETE');});
test('worker executes a queued call once and records INCOMPLETE honestly',withFixture(async f=>{let calls=0;const c={process:async()=>{},send:async()=>{}},w=new Worker(f.service,c,async(m,h)=>{calls++;return simulate(m,h);});approve(f,f.draft());await w.tick();await w.active.promise;await w.tick();assert.equal(calls,1);assert.equal(f.store.list('mission')[0].status,'INCOMPLETE');}));
test('worker re-checks suppression immediately before dialing',withFixture(async f=>{let calls=0;const w=new Worker(f.service,{process:async()=>{},send:async()=>{}},async()=>{calls++;return {};});approve(f,f.draft());f.store.suppress('one',f.contact.phone);await w.tick();assert.equal(calls,0);assert.equal(f.store.list('mission')[0].status,'FAILED');}));
test('worker restart never requeues an uncertain phone attempt',withFixture(async f=>{const m=f.draft();m.status='ACTIVE';f.store.put('mission',m);const w=new Worker(f.service,{process:async()=>{},send:async()=>{}},simulate);w.start();assert.equal(f.store.get('mission',m.id).status,'UNKNOWN');await w.stop();}));

// Bounded fault injection: no carrier request or fabricated success. Remove the synthetic
// error when an approved carrier timeout/cancel integration environment is available.
test('cancel request cannot turn an uncertain carrier submission into a confirmed cancellation',withFixture(async f=>{
 const m=approve(f,f.draft());m.status='DIALING';f.store.put('mission',m);
 const w=new Worker(f.service,null,async()=>{
  f.service.cancel(f.u,m.id);
  throw Object.assign(new Error('dial outcome unknown'),{code:'dial_request_outcome_unknown',uncertain:true});
 });
 await w.run(m,{abort:new AbortController(),control:{}});
 const result=f.store.get('mission',m.id);
 assert.equal(result.status,'UNKNOWN');assert.equal(result.carrierSid,undefined);
 assert.throws(()=>approve(f,f.draft(),'retry'),/active_call/);
}));
test('HTTP auth, review and start work without carrier or model credentials',withFixture(async f=>{const app=await createGateway(f.config,{store:f.store,execute:simulate,channels:{process:async()=>{},send:async()=>{}}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;const headers={authorization:'Bearer '+token,'content-type':'application/json'};try{assert.equal((await fetch(base+'/v1/bootstrap')).status,401);const draft=await fetch(base+'/v1/missions/draft',{method:'POST',headers,body:JSON.stringify({request:'田中さんに商談を提案'})}).then(r=>r.json());const review=await fetch(base+'/v1/missions/'+draft.id+'/review',{method:'POST',headers,body:'{}'}).then(r=>r.json());const started=await fetch(base+'/v1/missions/'+draft.id+'/start',{method:'POST',headers:{...headers,'idempotency-key':'http-test'},body:JSON.stringify({approvalToken:review.approvalToken,acknowledged:true})});assert.equal(started.status,202);assert.equal((await started.json()).status,'QUEUED');assert.equal((await fetch(base+'/v1/missions/'+draft.id,{headers:{authorization:'Bearer bob'}})).status,404);}finally{await app.close();}}));
test('configuration has no insecure hard-coded authentication fallback',()=>assert.throws(()=>configuration({}),/configure_operator_accounts/));

// Explicit timezone handling must never shift a callee's agreed time silently.
test('ISO UTC and offset evidence retains the actual instant',()=>{assert.equal(dateTime('2026-09-25T06:00:00Z',now),'2026-09-25T06:00:00Z');assert.equal(dateTime('2026-09-25T15:00:30+09:00',now),'2026-09-25T15:00:30+09:00');assert.equal(dateTime('2026-09-25T15:00:00+99:00',now),null);});
test('ordinary sales refusal immediately aborts the worker',withFixture(async f=>{let aborted=false;const m=approve(f,f.draft()),w=new Worker(f.service,{process:async()=>{},send:async()=>{}},async(_,hooks)=>{hooks.onEvent({type:'call.connected'});hooks.onEvent({type:'transcript.final',turnId:'no',source:'callee',text:'興味がありません'});aborted=hooks.signal.aborted;return {};});await w.tick();await w.active?.promise;assert(aborted);assert.equal(f.store.get('mission',m.id).status,'DECLINED');}));
test('startup marks interrupted follow-ups unknown without resending',withFixture(async f=>{f.store.put('followup',{id:'f',owner:f.u.id,status:'EXECUTING'});const w=new Worker(f.service,{process:async()=>{},send:async()=>{}},simulate);w.start();assert.equal(f.store.get('followup','f').status,'UNKNOWN');await w.stop();}));
test('mission deletion removes associated follow-up and notification content',withFixture(f=>{const m=f.draft();f.store.put('followup',{id:'f',owner:f.u.id,missionId:m.id});f.store.enqueue('outbox','out',f.u.id,{missionId:m.id,text:'private quote'});f.store.removeMission(m);assert.equal(f.store.get('followup','f'),null);assert.equal(f.store.get('outbox','out'),null);}));

const {Followups}=await import('../lib/followups.mjs');
function followFixture(f){const m=f.draft();m.mode='live';m.status='COMPLETED';m.result={verified:{material_send_allowed:true,meeting_agreed_on_call:'2026-09-25T15:00:00+09:00'},doNotContact:false};f.store.put('mission',m);const env={OATHRA_INTEGRATION_OWNER:f.u.id,GOOGLE_REFRESH_TOKEN:'test',GOOGLE_CLIENT_ID:'test',GOOGLE_CLIENT_SECRET:'test',HUBSPOT_ACCESS_TOKEN:'test',OATHRA_SMS_ENABLED:'true',TWILIO_AUTH_TOKEN:'test'};const a=new Followups(f.service,env);a.googleToken=async()=> 'not-a-real-token';return {m,a};}
test('follow-up preview does not send and uses the registered recipient',withFixture(f=>{const {m,a}=followFixture(f);const p=a.preview(f.u,m.id,{kind:'email',subject:'Test',body:'Hello',contactPermissionBasis:'Recipient requested email'});assert.equal(p.status,'PREVIEW');assert.equal(p.details.recipient,f.contact.email);assert.equal(f.store.list('followup')[0].status,'PREVIEW');assert(!f.store.list('followup')[0].approvalToken);}));
test('simulator results cannot initiate external follow-ups',withFixture(f=>{const {m,a}=followFixture(f);m.mode='simulator';f.store.put('mission',m);assert.throws(()=>a.preview(f.u,m.id,{kind:'email'}),/finished_real/);}));
test('integration credentials are not shared across accounts',withFixture(f=>{const {a}=followFixture(f);assert.deepEqual(a.available(f.service.user('bob')),[]);}));
test('follow-up sending requires separate explicit approval',withFixture(async f=>{const {m,a}=followFixture(f),p=a.preview(f.u,m.id,{kind:'email',subject:'Test',body:'Hello',contactPermissionBasis:'Requested'});await assert.rejects(a.execute(f.u,p.id,{approvalToken:p.approvalToken,acknowledged:false},'send'),/explicit_followup/);}));
test('follow-up idempotency prevents duplicate email after a successful send',withFixture(async f=>{const {m,a}=followFixture(f),p=a.preview(f.u,m.id,{kind:'email',subject:'Test',body:'Hello',contactPermissionBasis:'Requested'});let calls=0;a.send=async()=>{calls++;return {id:'provider-id'};};const input={approvalToken:p.approvalToken,acknowledged:true};const r=await a.execute(f.u,p.id,input,'send');await a.execute(f.u,p.id,input,'send');assert.equal(calls,1);assert.equal(r.status,'SUBMITTED');assert(!r.attendeeResponse);}));
test('uncertain external send is not automatically retried',withFixture(async f=>{const {m,a}=followFixture(f),p=a.preview(f.u,m.id,{kind:'sms',body:'Hello',contactPermissionBasis:'SMS expressly requested'});let calls=0;a.send=async()=>{calls++;throw Error('timeout');};const input={approvalToken:p.approvalToken,acknowledged:true};assert.equal((await a.execute(f.u,p.id,input,'send')).status,'UNKNOWN');await a.execute(f.u,p.id,input,'send');assert.equal(calls,1);}));
test('suppression after preview blocks external follow-up',withFixture(async f=>{const {m,a}=followFixture(f),p=a.preview(f.u,m.id,{kind:'email',subject:'Test',body:'Hello',contactPermissionBasis:'Requested'});f.store.suppress(f.u.team,m.target.phone);await assert.rejects(a.execute(f.u,p.id,{approvalToken:p.approvalToken,acknowledged:true},'send'),/suppressed/);}));
test('calendar creation is not represented as attendee acceptance',withFixture(async f=>{const {m,a}=followFixture(f),p=a.preview(f.u,m.id,{kind:'calendar',minutes:15});a.send=async()=>({id:'event-id'});const r=await a.execute(f.u,p.id,{approvalToken:p.approvalToken,acknowledged:true},'calendar');assert.equal(r.attendeeResponse,'needsAction');assert.equal(r.details.start,m.result.verified.meeting_agreed_on_call);}));
test('calendar request serializes only needsAction and exact evidence time',withFixture(async f=>{const {m,a}=followFixture(f),p=a.preview(f.u,m.id,{kind:'calendar',minutes:15});let body;a.fetchImpl=async(url,init)=>{body=JSON.parse(init.body);assert(url.includes('sendUpdates=all'));return {ok:true,json:async()=>({id:'event-id'})};};await a.send(p,'token');assert.equal(body.attendees[0].responseStatus,'needsAction');assert.equal(body.start.dateTime,'2026-09-25T15:00:00+09:00');}));
test('CRM notes escape markup instead of inserting active HTML',withFixture(async f=>{const {a}=followFixture(f);a.fetchImpl=async(_,init)=>{const b=JSON.parse(init.body);assert.equal(b.properties.hs_note_body,'&lt;script&gt;evil&lt;/script&gt;');return {ok:true,json:async()=>({id:'n'})};};await a.send({kind:'crm',details:{recipient:'123',body:'<script>evil</script>'}},null);}));
test('deleting a cancelled mission cannot erase daily spending reservations',withFixture(f=>{f.config.dailyCalls=1;const m=approve(f,f.draft());f.service.cancel(f.u,m.id);f.store.removeMission(m);assert.throws(()=>approve(f,f.draft(),'again'),/daily_limit/);}));
test('unknown carrier outcome blocks another call to the same recipient',withFixture(f=>{const m=approve(f,f.draft());m.status='UNKNOWN';f.store.put('mission',m);assert.throws(()=>approve(f,f.draft(),'again'),/active_call/);}));

// Reuse the existing simulator-only fixture; exercise real Service/Store/Channels, without a carrier or adapter mock.
test('phone input selects a registered contact and refuses conflicting or repeated recipients',withFixture(f=>{
  const domestic='0'+f.contact.phone.slice(3);
  const m=f.service.prepare(f.u,{request:`${domestic}に資料を案内`,productId:f.product.id});
  assert.equal(m.target.id,f.contact.id);assert.equal(m.target.phone,f.contact.phone);assert.equal(m.status,'DRAFT');
  assert.throws(()=>f.service.prepare(f.u,{request:`${f.contact.name}に案内`,phone:f.service.account(f.u).verifiedPhone}),/phone_target_conflict/);
  assert.throws(()=>f.service.prepare(f.u,{request:`${f.contact.phone}と${f.contact.phone}に案内`}),/multiple_phone_numbers/);
}));
test('unregistered phone draft never creates a consented contact or a start grant',withFixture(f=>{
  const count=f.store.list('contact',f.u.id).length;
  const m=f.service.prepare(f.u,{request:'資料を案内',phone:f.service.account(f.u).verifiedPhone});
  assert.equal(m.target.registrationRequired,true);assert.equal(f.store.list('contact',f.u.id).length,count);
  assert.throws(()=>f.service.review(f.u,m.id),/contact_registration_required/);
  assert.throws(()=>f.service.checkPolicy(f.u,m),/contact_registration_required/);
  assert.equal(f.service.edit(f.u,m.id,{request:'商品を案内'}).target.phone,m.target.phone);
  assert.equal(f.store.list('mission',undefined,'QUEUED').length,0);
}));
for(const kind of ['line','slack'])test(`${kind} accepts a phone request without a product and cannot approve a call`,withFixture(async f=>{
  f.store.db.prepare("DELETE FROM records WHERE kind='product'").run();
  f.service.link(kind,'U1',f.service.linkCode(f.u));
  const c=new Channels(f.service,{}),e={eventId:'evt1',actor:'U1',destination:'U1',sourceMessageId:'123',type:'message',text:`${f.contact.phone}に電話して`};
  const job={id:`${kind}:evt1`,payload:{kind,normalized:e}};
  await c.process(job);await c.process(job);
  const out=f.store.list('outbox');assert.equal(out.length,1);assert.deepEqual(out[0].payload.buttons,[]);
  assert.match(out[0].payload.text,/未発信/);assert.match(out[0].payload.text,/未接続|接続していません/);
  assert.equal(f.store.list('mission').length,0);assert.equal(f.store.list('reservation').length,0);
  const saved=f.store.open(f.store.key(`phone-request:${f.u.id}`,`${kind}:U1:123`));
  assert.equal(saved.request.kind,'oathra.phone-request');assert.equal(saved.request.phone,f.contact.phone);
  await c.process({id:`${kind}:unsend`,payload:{kind,normalized:{...e,type:'unsend'}}});
  assert.equal(f.store.key(`phone-request:${f.u.id}`,`${kind}:U1:123`),undefined);assert.equal(f.store.list('outbox').length,0);
}));

test('number-only channel request does not become a sales call when a product exists',withFixture(async f=>{
  f.service.link('line','U1',f.service.linkCode(f.u));const c=new Channels(f.service,{});
  await c.process({id:'line:evt1',payload:{kind:'line',normalized:{eventId:'evt1',actor:'U1',destination:'U1',type:'message',text:`${f.contact.phone}に電話して`}}});
  assert.equal(f.store.list('mission').length,0);assert.deepEqual(f.store.list('outbox')[0].payload.buttons,[]);
}));

test('generic channel draft refuses a registered name paired with a different phone',withFixture(f=>{
  assert.throws(()=>f.service.phoneRequest(f.u,{phone:f.service.account(f.u).verifiedPhone,name:f.contact.name,instruction:`${f.contact.name}に電話して`},{channel:'line'},'evt1'),/phone_target_conflict/);
  assert.equal(f.store.key(`phone-request:${f.u.id}`,'evt1'),undefined);
}));

// General contacts reuse the existing store/records; no provider or adapter substitute.
test('general contacts retain company and call notes without a phone or permission',withFixture(f=>{
  const c=f.service.contact(f.u,{id:f.contact.id,name:f.contact.name,company:f.product.name,notes:f.product.facts,lastCallNotes:f.contact.basis,phone:'',relationship:'',basis:''});
  assert.equal(c.phone,'');assert.equal(c.relationship,'');assert.equal(c.basis,'');
  assert.equal(f.service.own('contact',c.id,f.u).lastCallNotes,f.contact.basis);
  assert.throws(()=>f.draft(),/contact_phone_required/);
  assert.throws(()=>f.service.contact(f.u,{name:'',company:''}),/contact_name_or_company_required/);
  const company=f.service.contact(f.u,{id:c.id,name:'',company:c.company});
  assert.equal(company.name,'');assert.equal(company.company,f.product.name);
  assert.throws(()=>f.service.prepare(f.u,{request:f.product.name,productId:f.product.id}),/contact_phone_required/);
}));
test('general contact permissions are required at review and rechecked before execution',withFixture(f=>{
  f.service.contact(f.u,{...f.contact,relationship:'',basis:''});
  const m=f.draft();assert.throws(()=>f.service.review(f.u,m.id),/contact_relationship_required/);
  f.service.contact(f.u,{...f.contact,basis:''});
  assert.throws(()=>f.service.review(f.u,f.draft().id),/contact_basis_required/);
  f.service.contact(f.u,f.contact);const valid=f.draft(),r=f.service.review(f.u,valid.id);
  f.service.contact(f.u,{...f.contact,basis:''});
  assert.throws(()=>f.service.start(f.u,r.approvalToken,'one',true),/contact_basis_required/);
  assert.equal(f.store.list('mission',undefined,'QUEUED').length,0);
}));
test('LINE refuses a registered name without a phone and returns an actionable message',withFixture(async f=>{
  f.service.contact(f.u,{...f.contact,phone:''});
  f.service.link('line','U1',f.service.linkCode(f.u));const c=new Channels(f.service,{});
  await c.process({id:'line:event1',payload:{kind:'line',event:{type:'message',source:{type:'user',userId:'U1'},message:{type:'text',text:'田中さんに商談を提案'}}}});
  assert.equal(f.store.list('mission').length,0);
  assert.match(f.store.list('outbox')[0].payload.text,/電話番号がありません/);
}));
