// Real local API/storage and browser, with no telephone adapter: cannot dial a carrier.
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {startArena} from '../../apps/arena/dist/index.js';
import {launch,sleep} from './cdp.mjs';
if(existsSync('.env'))process.loadEnvFile('.env');
const number=process.env.PHONE_INPUT_TEST_NUMBER||process.env.TWILIO_PHONE_NUMBER;
if(!number){console.error('BLOCKED: locally configured number needed as input only; no calls.');process.exit(2);}
const work=mkdtempSync(join(tmpdir(),'oathra-web-phone-ui-')),out=resolve('artifacts/quality/web-phone');mkdirSync(out,{recursive:true});
const options={scenariosDir:resolve('scenarios'),brains:{},callsDir:join(work,'calls'),phoneHistoryDir:join(work,'phone'),port:0};
let arena=await startArena(options),page;
try{
 page=await launch({width:1280,height:900});await page.goto(arena.url+'/?lang=ja&phone=1');
 await page.until("document.querySelector('#phone-template').options.length===14");
 assert.match(await page.text('#phone-readiness'),/設定が必要/);
 await page.js("document.querySelector('#phone-number').focus()");await page.type(number);
 await page.js("document.querySelector('#phone-name').focus()");await page.type('設定済みの発信元');
 await page.js("{const s=document.querySelector('#phone-template');s.value='callback';s.dispatchEvent(new Event('change',{bubbles:true}))}");
 assert.match(await page.js("document.querySelector('#phone-instruction').value"),/\{\{/);
 await page.click('#phone-form button[type=submit]');await page.until("!document.querySelector('#phone-error').hidden");
 assert.equal((await(await fetch(arena.url+'/api/phone/history')).json()).length,0,'unresolved template is not a valid review');
 await page.js("{const n=document.querySelector('#phone-instruction');n.value='発信前の内容確認と履歴再利用の動作を確認します。実際の電話はかけません。';n.dispatchEvent(new Event('input',{bubbles:true}))}");
 const purpose=await page.js("document.querySelector('#phone-instruction').value");
 await page.click('#phone-form button[type=submit]');await page.until("!document.querySelector('#phone-review').hidden");
 assert.ok(await page.js("document.querySelector('#phone-dial').disabled"));await page.click('#phone-consent');assert.ok(await page.js("document.querySelector('#phone-dial').disabled"));
 assert.ok(!await page.visible('#phone-dial'));assert.ok(await page.visible('#phone-setup'));
 assert.match(await page.text('#phone-dial-hint'),/未発信/);
 await page.js("document.querySelector('#phone-number').style.webkitTextSecurity='disc';document.querySelector('#phone-review-fields dd').textContent='••••';document.querySelector('#phone-setup').scrollIntoView({block:'center'})");await page.screenshot(join(out,'setup-required.png'));
 await page.click('#phone-setup');assert.equal(await page.js("document.querySelector('#phone-readiness details').open"),true);
 let history=await(await fetch(arena.url+'/api/phone/history')).json();assert.equal(history.length,1);assert.equal(history[0].state,'draft');assert.equal(history[0].request.instruction,purpose);
 for(const approved of [false,true]){const r=await fetch(arena.url+'/api/phone/calls',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reviewId:history[0].id,approved})});assert.equal(r.status,approved?409:400);}
 assert.equal((await(await fetch(arena.url+'/api/phone/history')).json())[0].state,'draft');
 await page.click('#phone-clear');await page.click('#phone-history-section > summary');await page.until("document.querySelector('.phone-history-item button')");
 await page.click('.phone-history-item button');assert.equal(await page.js("document.querySelector('#phone-instruction').value"),purpose);assert.equal(await page.js("document.querySelector('#phone-number').value"),'');assert.equal(await page.js("document.querySelector('#phone-name').value"),'');
 assert.ok(!await page.visible('#phone-review'));
 await page.click('#phone-clear');await page.js("document.querySelectorAll('.phone-history-item button')[1].click()");assert.ok((await page.js("document.querySelector('#phone-number').value")).startsWith('+'));assert.equal(await page.js("document.querySelector('#phone-instruction').value"),purpose);
 for(const [label,width,height] of [['desktop',1280,900],['mobile',390,844]]){await page.viewport(width,height);assert.ok(await page.noSidewaysScroll());await page.js("document.querySelector('#phone-number').style.webkitTextSecurity='disc';document.querySelector('#phone-template').scrollIntoView({block:'start'})");await sleep(500);await page.screenshot(join(out,label+'.png'));}
 assert.equal((await(await fetch(arena.url+'/api/calls')).json()).length,0);assert.deepEqual(page.pageErrors,[]);
 arena.server.closeAllConnections();await arena.close();arena=await startArena(options);history=await(await fetch(arena.url+'/api/phone/history')).json();assert.equal(history.length,1);assert.equal(history[0].request.instruction,purpose);assert.equal(history[0].state,'draft');
 console.log('PASS: 13 real templates, unresolved placeholder rejection, immutable review/durable draft, unapproved/unconfigured refusal, purpose-only/full reuse with new review required, restart history, desktop/mobile, zero calls. No carrier adapter installed in this test.');
}finally{await page?.close();arena.server.closeAllConnections();await arena.close();rmSync(work,{recursive:true,force:true});}
