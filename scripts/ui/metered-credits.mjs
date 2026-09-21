// Bounded local accounting/UI check: real SQLite, API and Chrome; the worker never runs.
// Only queue/usage/terminal state fixtures are used, and the temporary DB is removed.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {createGateway,configuration} from '../../apps/gateway/server.mjs';
import {hash} from '../../apps/gateway/lib/security.mjs';
import {applyBillingEvent} from '../../apps/gateway/lib/billing.mjs';
import {launch} from './cdp.mjs';
process.loadEnvFile('.env');const number=process.env.TWILIO_PHONE_NUMBER;if(!number)throw Error('configured own input number required');
const dir=mkdtempSync(join(tmpdir(),'metered-ui-')),token=randomBytes(32).toString('hex'),user={id:randomUUID(),team:'local',role:'admin',tokenHash:hash(token)};
const config=configuration({OATHRA_USERS_JSON:JSON.stringify([user]),OATHRA_DATA_KEY:randomBytes(32).toString('hex'),OATHRA_DB:join(dir,'db.sqlite'),OATHRA_DEPLOYMENT:'managed',OATHRA_CREDIT_POLICY:'provider-cost-v1',OATHRA_CREDIT_USD:'0.01',OATHRA_CARRIER_JPY_PER_USD:'157.888307',OATHRA_CARRIER_FX_DATE:'2026-09-18',OATHRA_MAX_CALL_USD:'4',OATHRA_MAX_SECONDS:'60',OATHRA_DAILY_CALLS:'0',OATHRA_DAILY_USD:'0',OATHRA_VOICE_ENGINE:'gpt-live',OATHRA_VOICE_MODEL:'gpt-live-1',OATHRA_LIVE_PRICES_JSON:JSON.stringify({model:'gpt-live-1',version:'2026-09-20',perMinute:'0.01152'})});
const app=await createGateway(config,{env:{}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;config.publicUrl=base;
// Temporary readiness override only tests the durable approval boundary; no worker/executor starts.
config.mode='live';config.liveReady=true;config.callerId=number;config.missing=[];
app.service.credits.grant(user,user.id,400,randomUUID(),'local UI boundary');
const out=resolve('artifacts/quality/metered-credits');mkdirSync(out,{recursive:true});
let page;
try{
 page=await launch({width:1280,height:900});await page.goto(base+'/healthz');
 assert.equal(await page.js(`fetch('/v1/session',{method:'POST',headers:{authorization:'Bearer '+${JSON.stringify(token)},'content-type':'application/json'},body:'{}'}).then(r=>r.status)`),200);
 await page.emulateReducedMotion();await page.goto(base);await page.until("!document.querySelector('#screen-real').hidden");
 await page.js("document.querySelector('#phone-number').focus()");await page.type(number);await page.press('Tab');assert.equal((await page.focused()).id,'phone-name');await page.type('設定済みの発信元');await page.press('Tab');await page.type('発信せず、課金の保存と表示を確認します。');
 await page.click('#phone-form button[type=submit]');await page.until("document.querySelector('#phone-review').open");assert.match(await page.text('#phone-dial'),/最大 400/);assert.match(await page.text('#phone-price-details'),/0.01/);assert.match(await page.text('#phone-price-details'),/157.888307.*2026-09-18/);assert.match(await page.text('#phone-disclosure'),/精算・差額返却/);
 await page.js("document.querySelector('#phone-number').type='password';document.querySelector('#phone-review-fields dd').textContent='（番号は非公開）'");await page.screenshot(join(out,'confirmation.png'));
 await page.click('#phone-dial');await page.until("document.querySelector('#phone-live-state').textContent==='発信準備中'");
 const m=app.worker.claimNext();assert.ok(m);assert.equal(app.service.credits.usage(m).consumed,0);assert.equal(app.service.credits.usage(m).held,400);
 // Stop-state + provider quantities are strictly local fixtures, not a fabricated successful call.
 m.status='FAILED';m.finishedAt=Date.now();m.billing.executionFinished=true;
 // A 25 second media stream is one started voice minute.
 applyBillingEvent(m,{type:'billing.timing',startedAt:1000,endedAt:26000});
 app.store.put('mission',m);await page.until("document.querySelector('#phone-live-credits').textContent.includes('精算待ち')");await page.screenshot(join(out,'pending.png'));
 m.billing.carrier={costNanoUsd:10000000,durationSeconds:25,amount:'-1.57888307',currency:'JPY'};app.store.tx(()=>app.service.credits.settleTx(m));
 await page.until("document.querySelector('#phone-live-credits').textContent.includes('今回の消費：3')");assert.match(await page.text('#phone-live-credits'),/返却：397/);assert.match(await page.text('#phone-live-cost'),/通話 25秒.*回線.*音声AI/);assert.match(await page.text('#phone-live-cost'),/¥1.57888307/);
 const usage=app.service.credits.usage(m);assert.equal(usage.consumed,3);assert.equal(app.service.credits.balance(user.id).available,397);
 for(const [label,w,h] of [['settled-desktop',1280,900],['settled-mobile',390,844]]){
  await page.viewport(w,h);await page.js("document.querySelector('#phone-history-section').open=false;document.querySelector('#phone-live-recipient').textContent='設定済みの発信元（番号は非公開）';document.querySelector('#phone-live').scrollIntoView({block:'start'})");assert.ok(await page.noSidewaysScroll());await page.screenshot(join(out,label+'.png'));
 }
 await page.viewport(1280,900);await page.js("document.documentElement.style.zoom='2'");assert.ok(await page.noSidewaysScroll());assert.deepEqual(page.pageErrors,[]);
 writeFileSync(join(out,'ui.json'),JSON.stringify({at:new Date().toISOString(),boundaryOnly:true,workerStarted:false,consumed:usage.consumed,released:usage.released,balance:397,mobile:true,keyboardFocus:true,zoom200:true,reducedMotion:true,pageErrors:page.pageErrors,exitCode:0},null,2)+'\n');
 console.log('PASS: reservation, pending, settlement, returned balance, mobile, keyboard, 200% zoom; no phone calls');
}finally{if(page)await page.close();await app.close();rmSync(dir,{recursive:true,force:true});}
