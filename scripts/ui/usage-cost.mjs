// Bounded usage-rate accounting/UI check: real SQLite, API and Chrome; no carrier or worker runs.
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
const config=configuration({OATHRA_USERS_JSON:JSON.stringify([user]),OATHRA_DATA_KEY:randomBytes(32).toString('hex'),OATHRA_DB:join(dir,'db.sqlite'),OATHRA_DEPLOYMENT:'managed',OATHRA_CREDIT_POLICY:'provider-cost-v1',OATHRA_CREDIT_USD:'0.01',OATHRA_CARRIER_JPY_PER_USD:'157.888307',OATHRA_CARRIER_FX_DATE:'2026-09-18',OATHRA_MAX_CALL_USD:'4',OATHRA_MAX_SECONDS:'600',OATHRA_DAILY_CALLS:'0',OATHRA_DAILY_USD:'0',OATHRA_VOICE_ENGINE:'gpt-live',OATHRA_VOICE_MODEL:'gpt-live-1',OATHRA_LIVE_PRICES_JSON:JSON.stringify({model:'gpt-live-1',version:'2026-09-20',perMinute:'0.01152'})});
const usagePrices={version:'ui-boundary',carrier:[{prefix:number.slice(0,2),currency:'USD',perMinute:'0.2',incrementSeconds:60,source:'local accounting boundary'}],mediaPerMinute:'0.0044',search:{model:'gpt-5.4-mini',perCall:'0.01',input:'0.75',cached:'0.075',output:'4.5'}};
const {billingConfiguration}=await import('../../apps/gateway/lib/billing.mjs');config.billing=billingConfiguration({OATHRA_CREDIT_POLICY:'provider-cost-v1',OATHRA_CREDIT_USD:'0.01',OATHRA_VOICE_ENGINE:'gpt-live',OATHRA_VOICE_MODEL:'gpt-live-1',OATHRA_CARRIER_JPY_PER_USD:'157.888307',OATHRA_CARRIER_FX_DATE:'2026-09-18',OATHRA_LIVE_PRICES_JSON:JSON.stringify({model:'gpt-live-1',version:'ui-boundary',perMinute:'0.01152'}),OATHRA_SETTLEMENT_MODE:'usage-rate-v1',OATHRA_USAGE_PRICES_JSON:JSON.stringify(usagePrices)});
const app=await createGateway(config,{env:{}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;config.publicUrl=base;
// Temporary readiness override only tests the durable approval boundary; no worker/executor starts.
config.mode='live';config.liveReady=true;config.callerId=number;config.missing=[];
app.service.credits.grant(user,user.id,400,randomUUID(),'local UI boundary');
const out=resolve(process.env.UI_EVIDENCE_DIR??'artifacts/quality/usage-cost');mkdirSync(out,{recursive:true});
let page;
try{
 page=await launch({width:1280,height:900});await page.goto(base+'/healthz');
 assert.equal(await page.js(`fetch('/v1/session',{method:'POST',headers:{authorization:'Bearer '+${JSON.stringify(token)},'content-type':'application/json'},body:'{}'}).then(r=>r.status)`),200);
 await page.emulateReducedMotion();await page.goto(base);await page.until("!document.querySelector('#screen-real').hidden");
 await page.js("document.querySelector('#phone-number').focus()");await page.type(number);await page.press('Tab');assert.equal((await page.focused()).id,'phone-name');await page.type('設定済みの発信元');await page.press('Tab');await page.type('発信せず、課金の保存と表示を確認します。');
 await page.js("window.confirm=()=>true;document.querySelector('#phone-template').value='chat';document.querySelector('#phone-template').dispatchEvent(new Event('change'))");await page.click('#phone-form button[type=submit]');await page.until("document.querySelector('#phone-review').open");assert.match(await page.text('#phone-dial'),/最大 400/);assert.match(await page.text('#phone-review-fields'),/600秒/);assert.match(await page.text('#phone-price-details'),/0.01/);assert.match(await page.text('#phone-price-details'),/157.888307.*2026-09-18/);
 // The reviewed design: a plain-language cost line first, unit prices folded, and the decision visible without scrolling.
 assert.match(await page.text('#phone-cost-summary'),/1分あたり 約\d+クレジット（約\d+円）.*(いまの残高|1回の通話の上限) 400 クレジット.*自動で終わり.*返却/s);assert.equal(await page.js("document.querySelector('#phone-price-details').open"),false);assert.doesNotMatch(await page.text('#phone-review-fields'),/USD|gpt-|\$/);
 assert.equal(await page.js("(()=>{const d=document.querySelector('#phone-review').getBoundingClientRect(),b=document.querySelector('#phone-dial').getBoundingClientRect(),e=document.querySelector('#phone-edit').getBoundingClientRect();return b.top>=d.top&&e.bottom<=Math.min(d.bottom,innerHeight)+1&&b.height>=44})()"),true);
 assert.ok(await page.js("document.querySelectorAll('#phone-disclosure li').length")>=4);
 // What is being agreed to is inside the first view, above the decision, not only below the fold.
 assert.equal(await page.js("(()=>{const f=document.querySelector('.phone-review-actions').getBoundingClientRect(),li=document.querySelector('#phone-disclosure li').getBoundingClientRect();return li.bottom<=f.top+1})()"),true);assert.match(await page.text('#phone-dial-hint'),/Twilio.*OpenAI.*保存.*同意/);assert.match(await page.text('#phone-disclosure'),/終了時.*検索.*精算/);
 await page.js("document.querySelector('#phone-number').type='password';[...document.querySelectorAll('#phone-review-fields dt')].filter(n=>n.textContent==='電話番号').forEach(n=>n.nextElementSibling.textContent='（番号は非公開）')");await page.screenshot(join(out,'confirmation.png'));
 await page.click('#phone-dial');await page.until("document.querySelector('#phone-live-state').textContent==='発信準備中'");
 const m=app.worker.claimNext();assert.ok(m);assert.equal(app.service.credits.usage(m).consumed,0);assert.equal(app.service.credits.usage(m).held,400);
 // Stop-state + provider quantities are strictly local fixtures, not a fabricated successful call.
 m.status='FAILED';m.finishedAt=Date.now();m.billing.executionFinished=true;
 applyBillingEvent(m,{type:'billing.timing',startedAt:1000,endedAt:33000});applyBillingEvent(m,{type:'billing.search',kind:'response',id:'search-quantity',model:'gpt-5.4-mini',calls:1,usage:{input_tokens:1000,input_tokens_details:{cached_tokens:200},output_tokens:100}});
 m.billing.carrier={costNanoUsd:null,durationSeconds:32,amount:null,currency:'JPY'};app.store.tx(()=>app.service.credits.settleTx(m));
 await page.until("document.querySelector('#phone-live-credits').textContent.includes('今回の消費：23')");assert.match(await page.text('#phone-live-credits'),/返却：377/);assert.match(await page.text('#phone-live-cost'),/通話 32秒.*利用額/);await page.js("document.querySelector('#phone-cost-details summary').focus()");await page.press('Enter');assert.equal(await page.js("document.querySelector('#phone-cost-details').open"),true);assert.match(await page.text('#phone-cost-details'),/電話回線.*音声AI.*検索 1回.*音声AI（gpt-live-1）/s);assert.doesNotMatch(await page.text('#phone-cost-details'),/暫定/);assert.match(await page.text('#phone-cost-details'),/約20\.0クレジット（\$0\.200）/);
 await page.js("window.previousCost=document.querySelector('#phone-cost-details');document.querySelector('#phone-refresh').click()");await page.until("window.previousCost!==document.querySelector('#phone-cost-details')");assert.equal(await page.js("document.querySelector('#phone-cost-details').open"),true);
 const usage=app.service.credits.usage(m);assert.equal(usage.consumed,23);assert.equal(app.service.credits.balance(user.id).available,377);
 for(const [label,w,h] of [['settled-desktop',1280,900],['settled-mobile',390,844]]){
  await page.viewport(w,h);await page.js("document.querySelector('#phone-history-section').open=false;document.querySelector('#phone-live-recipient').textContent='設定済みの発信元（番号は非公開）';document.querySelector('#phone-live').scrollIntoView({block:'start'})");assert.ok(await page.noSidewaysScroll());await page.screenshot(join(out,label+'.png'));
 }
 await page.viewport(1280,900);await page.js("document.documentElement.style.zoom='2'");assert.ok(await page.noSidewaysScroll());assert.deepEqual(page.pageErrors,[]);
 writeFileSync(join(out,'ui.json'),JSON.stringify({at:new Date().toISOString(),boundaryOnly:true,workerStarted:false,consumed:usage.consumed,released:usage.released,balance:377,mobile:true,keyboardFocus:true,zoom200:true,reducedMotion:true,pageErrors:page.pageErrors,exitCode:0},null,2)+'\n');
 await page.goto(base);await page.until("!document.querySelector('#screen-real').hidden");await page.click('#phone-history-section summary');await page.until("document.querySelector('.phone-history-credits')?.textContent.includes('23')");assert.match(await page.text('#phone-history-list'),/電話回線.*gpt-live-1/s);
 // The actual leftover balance from settlement must fund a new approval below 400.
 assert.match(await page.text('#phone-credit-availability'),/377/);
 await page.click('#phone-form button[type=submit]');await page.until("document.querySelector('#phone-review').open");
 assert.match(await page.text('#phone-dial'),/最大 377/);assert.equal(await page.js("document.querySelector('#phone-dial').disabled"),false);
 await page.js("[...document.querySelectorAll('#phone-review-fields dt')].filter(n=>n.textContent==='電話番号').forEach(n=>n.nextElementSibling.textContent='（番号は非公開）')");
 await page.viewport(390,844);await page.js("document.querySelector('#phone-dial').scrollIntoView({block:'center'})");await page.screenshot(join(out,'377-ready.png'));
 await page.click('#phone-dial');await page.until("document.querySelector('#phone-live-state').textContent==='発信準備中'");
 const next=app.store.list('mission',user.id,'QUEUED');assert.equal(next.length,1);assert.equal(next[0].creditQuote.amount,377);assert.equal(app.service.credits.balance(user.id).held,377);
 await page.until("document.querySelector('#phone-credit-availability').textContent.includes('確保中')");assert.equal(await page.js("document.querySelector('#phone-form button[type=submit]').disabled"),true);
 await page.click('#phone-hangup');await page.until("document.querySelector('#phone-live-state').textContent==='通話終了'");await page.until("!document.querySelector('#phone-form button[type=submit]').disabled");assert.equal(app.service.credits.balance(user.id).available,377);
 // Separate temporary owners verify insufficient first-unit and zero-balance explanations.
 for(const amount of [20,0]){
  const value=randomBytes(32).toString('hex'),owner={id:randomUUID(),team:'local',role:'admin',tokenHash:hash(value)};config.users.push(owner);
  if(amount)app.service.credits.grant(user,owner.id,amount,randomUUID(),'local insufficient-balance boundary');
  await page.goto(base+'/healthz');assert.equal(await page.js(`fetch('/v1/session',{method:'POST',headers:{authorization:'Bearer '+${JSON.stringify(value)},'content-type':'application/json'},body:'{}'}).then(r=>r.status)`),200);
  await page.goto(base);await page.until("!document.querySelector('#screen-real').hidden");
  if(!amount){assert.match(await page.text('#phone-credit-availability'),/残高がありません/);assert.equal(await page.js("document.querySelector('#phone-form button[type=submit]').disabled"),true);continue}
  await page.js(`document.querySelector('#phone-number').value=${JSON.stringify(number)};document.querySelector('#phone-name').value='設定済みの発信元';document.querySelector('#phone-instruction').value='実発信せず最低料金の表示を確認します。'`);
  await page.click('#phone-form button[type=submit]');await page.until("document.querySelector('#phone-review').open");assert.equal(await page.js("document.querySelector('#phone-dial').disabled"),true);assert.equal(await page.js("(()=>{const h=document.querySelector('#phone-dial-hint'),b=document.querySelector('#phone-dial');return h.classList.contains('blocked')&&!h.hidden&&h.getBoundingClientRect().bottom<=b.getBoundingClientRect().top+1&&Number(getComputedStyle(b).opacity)<0.6})()"),true);assert.equal(await page.text('#phone-dial'),'クレジットが足りません');assert.doesNotMatch(await page.text('#phone-cost-summary'),/確保します/);assert.match(await page.text('#phone-dial-hint'),/クレジットが足りません.*最低 22.*残高 20/);
  await page.js("[...document.querySelectorAll('#phone-review-fields dt')].filter(n=>n.textContent==='電話番号').forEach(n=>n.nextElementSibling.textContent='（番号は非公開）')");await page.js("document.querySelector('#phone-dial-hint').scrollIntoView({block:'center'})");await page.screenshot(join(out,'insufficient.png'));
 }
 assert.deepEqual(page.pageErrors,[]);
 console.log('PASS: leftover377 can reserve377 and cancel/refund; held credits and minimum22 vs20/zero have visible reasons; no calls');
 console.log('PASS: immediate settlement without Call.price, search charges, durable itemization, returned balance, mobile, keyboard, 200% zoom; no phone calls');
}finally{if(page)await page.close();await app.close();rmSync(dir,{recursive:true,force:true});}
