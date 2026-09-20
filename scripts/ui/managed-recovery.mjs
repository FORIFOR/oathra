// Real loopback Gateway + SQLite + Chrome. No worker is started: never a PSTN call.
// Scoped fault fixture only delays/drops real HTTP responses to exercise recovery. It is
// removed by browser teardown; the temporary database and credentials are deleted in finally.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createGateway, configuration } from '../../apps/gateway/server.mjs';
import { hash } from '../../apps/gateway/lib/security.mjs';
import { launch, sleep } from './cdp.mjs';
if (existsSync('.env')) process.loadEnvFile('.env');
const number = process.env.PHONE_INPUT_TEST_NUMBER || process.env.TWILIO_PHONE_NUMBER;
if (!number) { console.error('BLOCKED: configured own number needed for local input only'); process.exit(2); }
const dir = mkdtempSync(join(tmpdir(), 'oathra-recovery-'));
const token = randomBytes(32).toString('hex'), user = {id:randomUUID(),team:'local',role:'admin',tokenHash:hash(token)};
const config = configuration({OATHRA_USERS_JSON:JSON.stringify([user]),OATHRA_DATA_KEY:randomBytes(32).toString('hex'),OATHRA_DB:join(dir,'db.sqlite'),OATHRA_DEPLOYMENT:'managed',OATHRA_CREDITS_PER_CALL:'3'});
const app = await createGateway(config,{env:{}}); let page;
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;config.publicUrl=base;
const out=resolve('artifacts/quality/implementation-review');mkdirSync(out,{recursive:true});
const request=async(path,body)=>{const response=await fetch(base+'/v1'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json','idempotency-key':randomUUID()},...(body?{body:JSON.stringify(body)}:{})});assert.ok(response.ok, 'HTTP '+response.status);return response.json()};
const fill=async(selector,value)=>page.js(`document.querySelector(${JSON.stringify(selector)}).value=${JSON.stringify(value)};document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('input',{bubbles:true}))`);
const delay=async(path,method='POST')=>page.js(`window.originalFetch=window.originalFetch??window.fetch;window.delayed=false;window.fetch=async(...args)=>{const r=await window.originalFetch(...args);if(args[0]===${JSON.stringify('/v1'+path)}&&(args[1]?.method??'GET')===${JSON.stringify(method)}){window.delayed=true;await new Promise(resolve=>window.releaseResponse=resolve)}return r}`);
const release=async()=>page.js('window.fetch=window.originalFetch;window.releaseResponse()');
try {
 const credentials={email:randomUUID()+'@example.invalid',password:randomBytes(24).toString('base64url')};
 const code=new URL(app.service.passwords.issue(user.id).url).hash.slice(7);
 const setup=await fetch(base+'/v1/auth/setup',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({...credentials,code})});assert.equal(setup.status,200);
 page=await launch({width:1280,height:900});await page.emulateReducedMotion();await page.goto(base);
 await fill('#managed-email',credentials.email);await fill('#managed-password',credentials.password);await page.click('#managed-login-submit');await page.until("!document.querySelector('#screen-real').hidden");
 await fill('#phone-number',number);await fill('#phone-name','設定済みの発信元');await fill('#phone-instruction','再読込後に入力内容を復元できるか確認します。');
 await page.goto(base);await page.until("!document.querySelector('#screen-real').hidden");assert.equal(await page.js("document.querySelector('#phone-number').value"),number);assert.match(await page.js("document.querySelector('#phone-instruction').value"),/再読込後/);assert.equal(app.store.list('mission').length,0);
 // Saving a contact twice and typing during its delayed real response must retain one row and the new typing.
 await page.click('#contacts-open');await page.until("!document.querySelector('#screen-contacts').hidden");await page.click('#contacts-new');
 await fill('#contact-name','Oathra');await fill('#contact-phone',number);await delay('/contacts');
 await page.js("const b=document.querySelector('#contact-form button[type=submit]');b.click();b.click()");await page.until('window.delayed');assert.equal(app.store.list('contact').length,1);
 await fill('#contact-notes','保存を待っている間の追加入力');await release();await page.until("document.querySelector('#contact-save-status').textContent.includes('未保存')");assert.equal(await page.js("document.querySelector('#contact-notes').value"),'保存を待っている間の追加入力');assert.equal(await page.js("document.querySelector('#contact-use').disabled"),true);
 await page.click('#contact-form button[type=submit]');await page.until("document.querySelector('#contact-save-status').textContent==='保存しました。'");assert.equal(app.store.list('contact').length,1);assert.equal(app.store.list('contact')[0].notes,'保存を待っている間の追加入力');
 await fill('#contact-name','保存前の変更');assert.equal(await page.js("document.querySelector('#contact-use').disabled"),true);
 const switching=page.click('#contacts-new');await sleep(300);await page.handleDialog(false);await switching;assert.equal(await page.js("document.querySelector('#contact-name').value"),'保存前の変更');
 await page.click('#contact-form button[type=submit]');await page.until("document.querySelector('#contact-save-status').textContent==='保存しました。'");await page.click('#contact-use');assert.equal(await page.js("document.querySelector('#phone-name').value"),'保存前の変更');
 // A lost contact-save response is replayed by the same idempotency key, including later typing.
 await page.click('#contacts-open');await page.until("!document.querySelector('#screen-contacts').hidden");await page.click('#contacts-new');
 await fill('#contact-name','Oathra 保存復帰');
 await page.js("window.originalFetch=window.fetch;window.fetch=async(...args)=>{const r=await window.originalFetch(...args);if(args[0]==='/v1/contacts'&&args[1]?.method==='POST')throw new TypeError('local contact response-loss boundary');return r}");
 await page.click('#contact-form button[type=submit]');await page.until("document.querySelector('#contacts-error').textContent.includes('もう一度保存')");
 assert.equal(app.store.list('contact').length,2);assert.notEqual(await page.text('#contact-save-status'),'保存中…');
 await page.js('window.fetch=window.originalFetch');await fill('#contact-notes','応答喪失後に追記');
 await page.click('#contact-form button[type=submit]');await page.until("document.querySelector('#contact-save-status').textContent.includes('未保存')");
 assert.equal(app.store.list('contact').length,2);assert.equal(await page.js("document.querySelector('#contact-notes').value"),'応答喪失後に追記');
 await page.click('#contact-form button[type=submit]');await page.until("document.querySelector('#contact-save-status').textContent==='保存しました。'");
 assert.equal(app.store.list('contact').length,2);assert.ok(app.store.list('contact').some(c=>c.notes==='応答喪失後に追記'));
 // Late contacts-list reads cannot navigate away from the current view.
 await delay('/contacts','GET');await page.click('#contacts-open');await page.until('window.delayed');await page.click('#home-open');await release();await sleep(300);assert.ok(await page.visible('#screen-home'));await page.click('#home-phone');
 // Queue boundary only. No execution is started; these configuration flags are temporary.
 config.mode='live';config.liveReady=true;config.callerId=number;config.missing=[];
 await request('/admin/credits/grants',{owner:user.id,amount:12,reason:'UI復帰と承認前拒否を発信せず確認'});await request('/consent',{version:config.consentVersion});
 const prepared=await request('/phone/draft',{phone:number,name:'設定済みの発信元',instruction:'実電話をかけず、キューからの復帰を確認します。'});
 await request('/missions/'+prepared.mission.id+'/start',{approvalToken:prepared.approvalToken,acknowledged:true});
 await page.goto(base);await page.until("document.querySelector('#phone-live-state').textContent==='発信準備中'");assert.equal(app.store.list('mission').length,1);assert.equal(app.service.credits.balance(user.id).held,3);assert.match(await page.js("document.querySelector('#phone-instruction').value"),/再読込後/);
 await page.js("const b=document.querySelector('#phone-hangup');b.click();b.click()");await page.until("document.querySelector('#phone-live-state').textContent==='通話終了'");assert.equal(app.store.get('mission',prepared.mission.id).status,'CANCELLED');assert.equal(app.service.credits.balance(user.id).held,0);
 await page.goto(base);await page.until("document.querySelector('#phone-live-state').textContent==='通話終了'");assert.equal(app.store.list('mission').length,1);
 // Consent version changes are a known pre-start rejection, not an unknown telephone result.
 await page.click('#phone-form button[type=submit]');await page.until("document.querySelector('#phone-review').open");const originalConsent=config.consentVersion;config.consentVersion='changed-for-local-boundary';
 await page.click('#phone-dial');await page.until("document.querySelector('#phone-error').textContent.includes('発信は受け付けられていません')");assert.equal(app.store.list('mission',user.id,'QUEUED').length,0);config.consentVersion=originalConsent;
 // A real accepted start whose HTTP response is lost is recovered by GET, with one reservation only.
 await page.click('#phone-form button[type=submit]');await page.until("document.querySelector('#phone-review').open");
 await page.js("window.originalFetch=window.fetch;window.fetch=async(...args)=>{const r=await window.originalFetch(...args);if(args[0].endsWith('/start'))throw new TypeError('local response-loss boundary');return r}");
 await page.click('#phone-dial');await page.until("document.querySelector('#phone-live-state').textContent==='発信準備中'");await page.js('window.fetch=window.originalFetch');assert.equal(app.store.list('mission',user.id,'QUEUED').length,1);assert.equal(app.service.credits.balance(user.id).held,3);
 await page.goto(base);await page.until("document.querySelector('#phone-live-state').textContent==='発信準備中'");assert.equal(app.store.list('mission',user.id,'QUEUED').length,1);
 await page.click('#phone-hangup');await page.until("document.querySelector('#phone-live-state').textContent==='通話終了'");
 for(const [name,width,height] of [['recovery-desktop',1280,900],['recovery-mobile',390,844]]){
  await page.viewport(width,height);await page.js("document.querySelector('#phone-number').type='password';document.querySelector('#phone-live-recipient').textContent='設定済みの発信元（非公開）';document.querySelector('#phone-live').scrollIntoView({block:'start'})");assert.ok(await page.noSidewaysScroll());await page.screenshot(join(out,name+'.png'));
 }
 // Expire the real session record, then reauthenticate and restore the same user's drafts.
 await page.click('#contacts-open');await page.until("!document.querySelector('#screen-contacts').hidden");await fill('#contact-notes','再ログイン後に復元する未保存メモ');
 app.store.db.prepare("UPDATE keys SET expires=0 WHERE scope='browser-session'").run();
 await page.click('#contact-form button[type=submit]');await page.until("!document.querySelector('#managed-login').hidden");
 assert.equal(await page.js("document.querySelector('#phone-instruction').value"),'');
 await fill('#managed-email',credentials.email);await fill('#managed-password',credentials.password);await page.click('#managed-login-submit');await page.until("!document.querySelector('#screen-real').hidden");
 assert.match(await page.js("document.querySelector('#phone-instruction').value"),/再読込後/);
 await page.click('#contacts-open');await page.until("!document.querySelector('#screen-contacts').hidden");assert.equal(await page.js("document.querySelector('#contact-notes').value"),'再ログイン後に復元する未保存メモ');
 await page.click('#contact-form button[type=submit]');await page.until("document.querySelector('#contact-save-status').textContent==='保存しました。'");assert.equal(app.store.list('contact').length,2);assert.ok(app.store.list('contact').some(c=>c.notes==='再ログイン後に復元する未保存メモ'));
 assert.deepEqual(page.pageErrors,[]);
 await page.click('#managed-logout');await page.until("!document.querySelector('#managed-login').hidden");assert.equal(await page.js("Object.keys(sessionStorage).filter(k=>k.startsWith('oathra:')).length"),0);
 console.log('PASS: same-tab draft/active-call/recent-result reload without redial, one-row double save, typing during save, native discard-dialog cancel, saved-contact target, late navigation read, one cancel/credit release, known consent rejection, lost accepted start recovery with one reservation, 390/1280px, no JS errors, logout clears recovery storage. No PSTN/API execution.');
} finally {await page?.close();await app.close();rmSync(dir,{recursive:true,force:true});}
