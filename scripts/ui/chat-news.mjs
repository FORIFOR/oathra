// Local authenticated UI + encrypted SQLite. No worker, carrier or news API is started.
// The real API evidence is replayed only into a temporary draft to check source persistence/rendering.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {createGateway,configuration} from '../../apps/gateway/server.mjs';
import {hash} from '../../apps/gateway/lib/security.mjs';
import {launch} from './cdp.mjs';
const number=process.env.TWILIO_PHONE_NUMBER;if(!number)throw Error('BLOCKED: configured own number required for local input; no call');
const dir=mkdtempSync(join(tmpdir(),'oathra-chat-news-')),token=randomBytes(32).toString('hex');
const user={id:randomUUID(),team:'local',role:'admin',tokenHash:hash(token)};
const config=configuration({OATHRA_USERS_JSON:JSON.stringify([user]),OATHRA_DATA_KEY:randomBytes(32).toString('hex'),OATHRA_DB:join(dir,'db.sqlite'),OATHRA_DEPLOYMENT:'managed',OATHRA_CREDITS_PER_CALL:'3'});
let app=await createGateway(config,{env:{}}),page;await new Promise(r=>app.server.listen(0,'127.0.0.1',r));let base='http://127.0.0.1:'+app.server.address().port;config.publicUrl=base;
const out=resolve('artifacts/quality/chat-news');mkdirSync(out,{recursive:true});
const api=async path=>{const r=await fetch(base+'/v1'+path,{headers:{authorization:'Bearer '+token}});assert.equal(r.status,200);return r.json()};
try{
 const credentials={email:randomUUID()+'@example.invalid',password:randomBytes(24).toString('base64url')};
 const code=new URL(app.service.passwords.issue(user.id).url).hash.slice(7);
 const setup=await fetch(base+'/v1/auth/setup',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({...credentials,code})});assert.equal(setup.status,200);
 page=await launch({width:1280,height:900});await page.emulateReducedMotion();await page.goto(base);
 await page.js("document.querySelector('#managed-email').focus()");await page.type(credentials.email);await page.press('Tab');await page.type(credentials.password);await page.press('Enter');await page.until("!document.querySelector('#screen-real').hidden");
 await page.js("document.querySelector('#phone-template').value='chat';document.querySelector('#phone-template').dispatchEvent(new Event('change'))");
 assert.match(await page.js("document.querySelector('#phone-instruction').value"),/雑談/);assert.match(await page.text('#phone-chat-note'),/運営者負担/);
 assert.equal((await page.focused()).id,'phone-instruction');
 await page.js("document.querySelector('#phone-number').focus()");await page.type(number);await page.js("document.querySelector('#phone-name').focus()");await page.type('設定済みの発信元');
 await page.click('#phone-form button[type=submit]');await page.until("document.querySelector('#phone-review').open");
 assert.match(await page.text('#phone-review-fields'),/雑談/);assert.match(await page.text('#phone-disclosure'),/カテゴリ.*運営者負担/);assert.equal(await page.js("document.querySelector('#phone-dial').disabled"),true);
 const [record]=await api('/phone/history');assert.equal(record.request.conversationMode,'chat');assert.equal(record.state,'draft');
 await page.press('Escape');
 // A template replaces the text at once, without a native confirm; one explicit undo brings back the reviewed chat mode and its text.
 const reviewedText=await page.js("document.querySelector('#phone-instruction').value");
 await page.js("window.confirm=()=>{throw new Error('native confirm must not be used')};document.querySelector('#phone-template').value='callback';document.querySelector('#phone-template').dispatchEvent(new Event('change'))");
 assert.equal(await page.js("document.querySelector('#phone-template').value"),'callback');assert.equal(await page.visible('#phone-chat-note'),false);assert.equal(await page.visible('#phone-template-undo'),true);
 await page.click('#phone-template-undo');
 assert.equal(await page.js("document.querySelector('#phone-template').value"),'chat');assert.equal(await page.js("document.querySelector('#phone-instruction').value"),reviewedText);assert.equal(await page.visible('#phone-chat-note'),true);assert.equal(await page.visible('#phone-template-undo'),false);
 await page.click('#phone-clear');assert.equal(await page.visible('#phone-chat-note'),false);
 await page.click('#phone-history-section summary');await page.click('.phone-history-item button');
 assert.equal(await page.js("document.querySelector('#phone-template').value"),'chat');assert.equal(await page.visible('#phone-chat-note'),true);
 await page.js("document.querySelector('#phone-template').value='';document.querySelector('#phone-template').dispatchEvent(new Event('change'))");
 assert.equal(await page.visible('#phone-chat-note'),false);
 await page.click('#phone-clear');await page.js("window.confirm=()=>true");await page.click('.phone-history-item button');
 // News payload was obtained from the real provider independently; no fabricated headline.
 const evidence=JSON.parse(readFileSync(join(out,'live-news-round2.json'),'utf8')).result;assert.equal(evidence.status,'verified');
 app.store.event(app.store.get('mission',record.id),{type:'news.lookup',result:evidence});
 await page.click('.phone-history-item button:last-child');await page.until("!!document.querySelector('#phone-news')&&!document.querySelector('#phone-news').hidden");
 await page.click('#phone-news summary');assert.equal(await page.js("document.querySelector('#phone-news a').href"),evidence.sources[0].url);
 assert.match(await page.text('#phone-news'),/2026/);assert.equal((await api('/phone/calls/'+record.id)).news[0].text,evidence.text);
 for(const [label,w,h] of [['desktop',1280,900],['mobile',390,844]]){
  await page.viewport(w,h);await page.js("document.querySelector('#phone-number').value='';document.querySelector('#phone-live-recipient').textContent='設定済みの発信元（番号は非公開）';window.scrollTo(0,0)");
  assert.equal(await page.noSidewaysScroll(),true);await page.screenshot(join(out,label+'.png'));
 }
 await page.js("document.body.style.zoom='2'");assert.equal(await page.noSidewaysScroll(),true);await page.js("document.body.style.zoom='1'");
 await page.click('#managed-account-button');await page.click('#managed-logout');await page.until("!document.querySelector('#managed-login').hidden");assert.equal(await page.js("document.querySelector('#phone-news')"),null);assert.deepEqual(page.pageErrors,[]);
 await page.close();page=null;await app.close();app=await createGateway(config,{env:{}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;
 const saved=await api('/phone/calls/'+record.id);assert.equal(saved.request.conversationMode,'chat');assert.deepEqual(saved.news,[evidence]);assert.equal(saved.state,'draft');
 writeFileSync(join(out,'ui-result.json'),JSON.stringify({status:'PASS',mode:saved.request.conversationMode,persistence:'after server restart',newsSources:saved.news[0].sources.length,phoneCalls:0,viewports:[1280,390],zoom:'CSS 200%',ime:'not exercised',pageErrors:[]},null,2));
 console.log('PASS: chat selection/editable purpose, review disclosure, saved mode, cancelled replacement, clear, history reuse, blank resets mode, dated sources display/persist, reload, logout privacy, mobile/desktop, keyboard focus, reduced motion, CSS 200%. No call.');
}finally{await page?.close();await app.close();rmSync(dir,{recursive:true,force:true})}
