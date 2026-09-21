// Shared original UI + authenticated Gateway/SQLite. Worker is NEVER started; queue-only approval test is marked below.
import assert from 'node:assert/strict';import {randomBytes,randomUUID} from 'node:crypto';import {mkdtempSync,mkdirSync,rmSync,existsSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {createGateway,configuration} from '../../apps/gateway/server.mjs';import {hash} from '../../apps/gateway/lib/security.mjs';import {gatewayClient} from '../../sdk/gateway-client/index.mjs';import {launch,sleep} from './cdp.mjs';
if(existsSync('.env'))process.loadEnvFile('.env');const number=process.env.PHONE_INPUT_TEST_NUMBER||process.env.TWILIO_PHONE_NUMBER;if(!number){console.error('BLOCKED: configured own number needed for input only');process.exit(2)}
const dir=mkdtempSync(join(tmpdir(),'oathra-shared-phone-')),token=randomBytes(32).toString('hex'),other=randomBytes(32).toString('hex');
const user={id:randomUUID(),team:'local',role:'admin',tokenHash:hash(token)},otherUser={id:randomUUID(),team:'local',role:'operator',tokenHash:hash(other)};
const config=configuration({OATHRA_USERS_JSON:JSON.stringify([user,otherUser]),OATHRA_DATA_KEY:randomBytes(32).toString('hex'),OATHRA_DB:join(dir,'db.sqlite'),OATHRA_DEPLOYMENT:'managed',OATHRA_CREDITS_PER_CALL:'3'});
let app=await createGateway(config,{env:{}}),page;await new Promise(r=>app.server.listen(0,'127.0.0.1',r));let base='http://127.0.0.1:'+app.server.address().port;config.publicUrl=base;
const out=resolve(process.env.UI_EVIDENCE_DIR??'artifacts/quality/easy-phone');mkdirSync(out,{recursive:true});
const req=(path,body,auth=token)=>fetch(base+'/v1'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+auth,'content-type':'application/json','idempotency-key':randomUUID()},...(body?{body:JSON.stringify(body)}:{})});
// Bounded temporary credentials verify real authentication; discarded with the temporary database.
const credentials=new Map();
for(const [value,u] of [[token,user],[other,otherUser]]){
 const c={email:randomUUID()+'@example.invalid',password:randomBytes(24).toString('base64url')};credentials.set(value,c);
 const code=new URL(app.service.passwords.issue(u.id).url).hash.slice(7);
 const r=await fetch(base+'/v1/auth/setup',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({...c,code})});assert.equal(r.status,200);
}
async function login(value){const c=credentials.get(value);await page.js("document.querySelector('#managed-email').focus()");await page.type(c.email);await page.press('Tab');await page.type(c.password);await page.press('Enter');await page.until("!document.querySelector('#screen-real').hidden");}
try {
 page=await launch({width:1280,height:900});await page.emulateReducedMotion();await page.goto(base);await login(token);await page.goto(base);await page.until("!document.querySelector('#screen-real').hidden");assert.equal(await page.js('document.cookie'), '');assert.equal(await page.text('#screen-real h2'),'電話をかける');assert.equal(await page.js("document.querySelector('#phone-template').options.length"),14);
 // The voice is chosen like any other field: a labelled native select, the default marked, the choice shown again before consent.
 assert.equal(await page.js("document.querySelector('#phone-voice').options.length"),13);assert.equal(await page.js("document.querySelector('#phone-voice').value"),'marin');assert.equal(await page.text('label[for=phone-voice]'),'AIの声');assert.match(await page.js("document.querySelector('#phone-voice').selectedOptions[0].textContent"),/標準/);
 // A name alone says nothing: every option says how high and how fast the voice is, and the sample can be heard.
 assert.equal(await page.js("[...document.querySelector('#phone-voice').options].every(o=>/(低め|中くらい|高め)の.*(速め|速さ|ゆっくり)/.test(o.textContent))"),true);assert.match(await page.js("[...document.querySelector('#phone-voice').options].find(o=>o.value==='vesper').textContent"),/低めの声/);assert.equal(await page.visible('#phone-voice-preview'),true);assert.match(await page.js("[...document.querySelector('#phone-voice').options].find(o=>o.value==='marin').textContent"),/^★ 推奨 marin/);assert.equal(await page.js("[...document.querySelector('#phone-voice').options].filter(o=>o.textContent.startsWith('★ 推奨')).length>=1"),true);assert.match(await page.text('#phone-voice-note'),/推奨は、標準の声/);assert.equal((await fetch(base+'/phone/voices/vesper.wav')).headers.get('content-type'),'audio/wav');
 await page.js("document.querySelector('#phone-voice').value='vesper';document.querySelector('#phone-voice').dispatchEvent(new Event('change',{bubbles:true}))");
 // The callee should hear whose call this is: a labelled field, confirmed before consent on the existing row.
 assert.equal(await page.text('label[for=phone-caller-name]'),'あなたの名前（相手に伝えます）');
 // Optional settings come after the three required fields; Tab from the recipient still reaches the purpose.
 assert.equal(await page.js("(()=>{const order=[...document.querySelectorAll('#phone-form input,#phone-form textarea,#phone-form select')].map(e=>e.id);return order.indexOf('phone-number')<order.indexOf('phone-name')&&order.indexOf('phone-name')+1===order.indexOf('phone-instruction')&&order.indexOf('phone-instruction')<order.indexOf('phone-caller-name')&&order.indexOf('phone-caller-name')<order.indexOf('phone-voice')})()"),true);await page.js("const i=document.querySelector('#phone-caller-name');i.value='確認用の名前';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}))");
 await page.js("document.querySelector('#phone-number').focus()");await page.type(number);await page.js("document.querySelector('#phone-name').focus()");await page.type('設定済みの発信元');await page.js("document.querySelector('#phone-template').value='callback';document.querySelector('#phone-template').dispatchEvent(new Event('change'))");await page.click('#phone-form button[type=submit]');await page.until("!document.querySelector('#phone-error').hidden");assert.equal((await(await req('/phone/history')).json()).length,0);
 await page.js("document.querySelector('#phone-instruction').value='元の画面と同じ操作で、下書きと履歴の保存を確認します。実際の電話はかけません。';document.querySelector('#phone-instruction').dispatchEvent(new Event('input'))");
 await page.js("window.confirm=()=>{throw new Error('template selection must not use native confirm')};document.querySelector('#phone-template').value='availability';document.querySelector('#phone-template').dispatchEvent(new Event('change'))");
 assert.match(await page.js("document.querySelector('#phone-instruction').value"),/希望日時.*人数/);assert.equal(await page.visible('#phone-template-undo'),true);await page.click('#phone-template-undo');assert.match(await page.js("document.querySelector('#phone-instruction').value"),/元の画面/);
 await page.js("const submit=document.querySelector('#phone-form button[type=submit]');submit.click();submit.click()");await page.until("document.querySelector('#phone-review').open");assert.match(await page.text('#phone-review-fields'),/AIの声 vesper/);assert.match(await page.text('#phone-review-fields'),/確認用の名前さんの代わりと名乗ります/);assert.equal(await page.js("document.querySelectorAll('#phone-review-fields dt').length"),4);assert.equal((await(await req('/phone/history')).json())[0].request.voice,'vesper');assert.ok(await page.visible('#phone-setup'));assert.equal(await page.js("document.querySelector('#phone-dial').disabled"),true);assert.equal(await page.js("document.querySelector('#phone-consent')"),null);await page.press('Escape');assert.equal(await page.js("document.querySelector('#phone-review').open"),false);assert.equal((await page.focused()).id,'phone-instruction');
 const history=await(await req('/phone/history')).json();assert.equal(history.length,1);assert.equal(history[0].state,'draft');const id=history[0].id;
 assert.equal((await req('/phone/calls/'+id,null,other)).status,404);
 const consent=(await(await req('/bootstrap')).json()).configuration.consentVersion;await req('/consent',{version:consent});
 const reviewed=await(await req('/missions/'+id+'/review',{})).json();
 const start=await req('/missions/'+id+'/start',{approvalToken:reviewed.approvalToken,acknowledged:true});
 assert.equal(start.status,409);assert.equal((await start.json()).error,'phone_service_preview_only');assert.equal(app.store.get('mission',id).status,'DRAFT');
 // Temporary interruption state verifies recovery without creating a carrier response/call.
 const stored=app.store.get('mission',id);stored.transcript=[{id:'memory-ui',source:'callee',text:'19時半でしたら空いております。',t:1}];stored.status='UNKNOWN';stored.error='worker_interrupted_reconcile_carrier_before_retry';app.store.put('mission',stored);
 await page.click('#phone-history-refresh');await page.until("document.querySelector('#phone-history-list').textContent.includes('結果未確認')");
 await page.click('.phone-history-item button:last-child');assert.ok(await page.visible('#phone-resolve'));assert.ok(await page.visible('#phone-hangup'));
 // An unknown result blocks a second dial and says why, independent of the balance; the named action is the primary one.
 assert.equal(await page.js("document.querySelector('#phone-form button[type=submit]').disabled"),true);assert.match(await page.text('#phone-credit-availability'),/前の電話の結果を確認できていません/);assert.equal(await page.js("(()=>{const b=document.querySelector('#phone-form button[type=submit]').getBoundingClientRect(),r=document.querySelector('#phone-submit-reason');return !r.hidden&&/前の電話の結果/.test(r.textContent)&&r.getBoundingClientRect().top-b.bottom<24})()"),true);assert.ok(await page.visible('#phone-credit-availability'));assert.equal(await page.js("document.querySelector('#phone-resolve').classList.contains('primary')"),true);
 await page.js("document.querySelector('#phone-memory').open=true;document.querySelector('[data-memory=changes]').open=true");await page.click('#phone-refresh');assert.equal(await page.js("document.querySelector('[data-memory=changes]').open"),true);
 assert.match(await page.text('#phone-memory'),/19:30/);assert.match(await page.text('#phone-memory'),/提案・未確認/);
 await page.js("[...document.querySelector('.phone-history-item').querySelectorAll('button')].find(b=>b.textContent==='前回の内容を引き継ぐ').click()");assert.match(await page.js("document.querySelector('#phone-instruction').value"),/前回の通話メモ.*19:30/s);await page.click('#phone-template-undo');assert.match(await page.js("document.querySelector('#phone-instruction').value"),/元の画面/);
 await page.click('#phone-resolve');await page.until("document.querySelector('#phone-live-error').textContent.includes('管理者')");assert.equal(app.store.get('mission',id).status,'UNKNOWN');
 stored.status='DRAFT';delete stored.error;app.store.put('mission',stored);await page.click('#phone-refresh');assert.equal((await(await req('/phone/history',null,other)).json()).length,0);
 await page.click('#home-open');await page.click('#navigation-back');assert.ok(await page.visible('#screen-real'));assert.match(await page.js("document.querySelector('#phone-instruction').value"),/元の画面/);
 await page.click('#phone-clear');await page.click('#phone-history-section summary');await page.click('.phone-history-item button');assert.match(await page.js("document.querySelector('#phone-instruction').value"),/元の画面/);assert.equal(await page.js("document.querySelector('#phone-number').value"),'');
 for(const [label,w,h] of [['desktop',1280,900],['mobile',390,844]]){await page.viewport(w,h);await page.js('window.scrollTo(0,0)');await sleep(500);assert.ok(await page.noSidewaysScroll());await page.screenshot(join(out,label+'.png'));}
 // Use the configured own number for local contact input only; no fictional recipient.
 await req('/contacts',{name:'設定済みの発信元',phone:number});await req('/contacts',{company:'Oathra'},other);
 await page.click('#contacts-open');await page.until("!document.querySelector('#screen-contacts').hidden && !!document.querySelector('#contacts-list button')");await page.click('#contacts-list button');
 assert.equal(await page.js("document.querySelector('#contact-use').disabled"),false);
 await page.click('#managed-account-button');await page.click('#managed-logout');await page.until("!document.querySelector('#managed-login').hidden");await page.goto(base);assert.ok(await page.visible('#managed-login'));await login(other);
 await page.click('#contacts-open');await page.until("!document.querySelector('#screen-contacts').hidden");
 assert.equal(await page.js("document.querySelector('#contact-use').disabled"),true);assert.equal(await page.js("document.querySelector('#contact-phone').value"),'');
 await page.click('.tt-btn[data-transport=real]');assert.equal(await page.js("document.querySelector('#phone-instruction').value"),'');assert.match(await page.text('#phone-history-list'),/まだありません/);// CSS 200% zoom and reduced motion are browser checks, not a native OS IME test.
 await page.viewport(1280,900);await page.js("document.documentElement.style.zoom='2'");assert.ok(await page.noSidewaysScroll());
 await page.js("document.querySelector('#phone-number').focus()");await page.press('Tab');assert.equal((await page.focused()).id,'phone-name');assert.ok((await page.focused()).outline);
 await page.screenshot(join(out,'zoom-200.png'));assert.deepEqual(page.pageErrors,[]);
 // Bounded setup-state injection to verify approval/credits at the durable queue boundary.
 // No executor/worker is started, so no carrier or AI can be contacted. This is not PSTN evidence.
 await page.js("document.documentElement.style.zoom=''");await page.click('#managed-account-button');await page.click('#managed-logout');await page.until("!document.querySelector('#managed-login').hidden");
 config.mode='live';config.liveReady=true;config.callerId=number;config.missing=[];
 assert.equal((await req('/admin/credits/grants',{owner:user.id,amount:3,reason:'ローカルの承認と取消の境界確認'})).status,200);
 await login(token);assert.equal(await page.text('#phone-form button[type=submit]'),'電話する');
 await page.js("document.querySelector('#phone-number').focus()");await page.type(number);await page.js("document.querySelector('#phone-name').focus()");await page.type('設定済みの発信元');await page.js("document.querySelector('#phone-instruction').value='発信せずに、承認とキュー待ち取消の保存を検証します。'");
 await page.click('#phone-form button[type=submit]');await page.until("document.querySelector('#phone-review').open");
 assert.equal(await page.js("document.querySelector('#phone-dial').disabled"),false);assert.match(await page.text('#phone-dial'),/同意して電話する.*3/);assert.match(await page.text('#phone-disclosure'),/TwilioとOpenAI/);
 // Mask only the displayed number for screenshots; the request still uses the configured own number.
 await page.js("document.querySelector('#phone-number').type='password';document.querySelector('#phone-review-fields dd').textContent='（番号は非公開）'");
 for(const [label,w,h] of [['confirmation',1280,900],['confirmation-mobile',390,844]]){await page.viewport(w,h);assert.ok(await page.noSidewaysScroll());await page.screenshot(join(out,label+'.png'));}
 await page.js("const dial=document.querySelector('#phone-dial');dial.click();dial.click()");await page.until("document.querySelector('#phone-live-state').textContent==='発信準備中'");
 const queued=app.store.list('mission',user.id,'QUEUED');assert.equal(queued.length,1);assert.equal(queued[0].executionId,undefined);assert.equal(app.service.credits.balance(user.id).held,3);assert.match(await page.text('#phone-live-credits'),/今回の消費：0.*確保中：3/);
 await page.click('#phone-hangup');await page.until("document.querySelector('#phone-live-state').textContent==='通話終了'");assert.equal(app.store.get('mission',queued[0].id).status,'CANCELLED');assert.equal(app.service.credits.balance(user.id).available,3);assert.equal(app.service.credits.balance(user.id).held,0);
 await page.until("document.querySelector('#phone-live-credits').textContent.includes('返却：3')");assert.match(await page.text('#phone-live-credits'),/今回の消費：0/);
 // Commit the real accounting claim without starting any execution. Simulate only the
 // subsequent interrupted-process state; never invent a successful carrier response.
 const next=await(await req('/phone/draft',{phone:number,name:'設定済みの発信元',instruction:'実行確定後の消費表示を、電話をかけずに検証します。'})).json();
 assert.equal((await req('/missions/'+next.mission.id+'/start',{approvalToken:next.approvalToken,acknowledged:true})).status,202);
 const claimed=app.worker.claimNext();assert.equal(claimed.id,next.mission.id);
 claimed.status='UNKNOWN';claimed.error='worker_interrupted_reconcile_carrier_before_retry';app.store.put('mission',claimed);
 await page.click('#phone-history-refresh');await page.until("document.querySelector('.phone-history-item').textContent.includes('今回の消費：3')");
 await page.click('.phone-history-item button:last-child');await page.until("document.querySelector('#phone-live-state').textContent==='結果未確認'&&document.querySelector('#phone-live-balance').textContent.includes('現在の残高：0')");
 assert.equal(await page.text('#phone-live-credits'),'今回の消費：3 クレジット');
 for(const [label,w,h] of [['credit-result',1280,900],['credit-result-mobile',390,844]]){
  await page.viewport(w,h);await page.js("document.querySelector('#phone-live-recipient').textContent='設定済みの発信元（番号は非公開）';document.querySelector('#phone-live').scrollIntoView({block:'start'})");assert.ok(await page.noSidewaysScroll());await page.screenshot(join(out,label+'.png'));
 }
 config.mode='simulator';config.liveReady=false;delete config.callerId;
 assert.deepEqual(page.pageErrors,[]);
 // Use a fresh server instance to verify the persisted account-scoped record, not just browser DOM.
 await page.close();page=null;await app.close();app=await createGateway(config,{env:{}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;
 const sdk=gatewayClient({baseUrl:base,token});assert.equal((await sdk.phoneRecord(id)).state,'draft');assert.equal((await sdk.phoneHistory()).length,3);assert.equal((await sdk.phoneTemplates()).length,13);assert.equal((await sdk.phoneStatus()).ready,false);assert.equal(app.store.list('mission').length,3);
 console.log('PASS: original shared markup/styles, authenticated three-field phone flow, 13 templates, invalid placeholders rejected, durable draft/history/reuse, back preserves input, cross-user contact privacy/logout, unknown recovery without SID, preview execution rejected, restart persistence, 1280/390px, CSS 200% zoom, reduced motion, keyboard focus, cookie session reload/logout, 2-step approval (queue-only), duplicate clicks, credit reserve/cancel release, per-call actual consumption with unknown call result, no calls.');
}finally{await page?.close();await app.close();rmSync(dir,{recursive:true,force:true})}
