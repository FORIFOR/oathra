// The two result states the other managed flows never reach: a call in progress and a call that ended normally.
// Authenticated Gateway + real SQLite; the worker is NEVER started and nothing is dialled. The stored state and
// transcript below are local fixtures for rendering only, never a claim that such a call took place.
import assert from 'node:assert/strict';import {randomBytes,randomUUID} from 'node:crypto';import {mkdtempSync,mkdirSync,rmSync,existsSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {createGateway,configuration} from '../../apps/gateway/server.mjs';import {hash} from '../../apps/gateway/lib/security.mjs';import {launch,sleep} from './cdp.mjs';
if(existsSync('.env'))process.loadEnvFile('.env');const number=process.env.PHONE_INPUT_TEST_NUMBER||process.env.TWILIO_PHONE_NUMBER;if(!number){console.error('BLOCKED: configured own number needed for input only');process.exit(2)}
const dir=mkdtempSync(join(tmpdir(),'oathra-managed-states-')),token=randomBytes(32).toString('hex');
const user={id:randomUUID(),team:'local',role:'admin',tokenHash:hash(token)};
const config=configuration({OATHRA_USERS_JSON:JSON.stringify([user]),OATHRA_DATA_KEY:randomBytes(32).toString('hex'),OATHRA_DB:join(dir,'db.sqlite'),OATHRA_DEPLOYMENT:'managed',OATHRA_CREDITS_PER_CALL:'3'});
const app=await createGateway(config,{env:{}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;config.publicUrl=base;
const out=resolve(process.env.UI_EVIDENCE_DIR??'artifacts/quality/managed-states');mkdirSync(out,{recursive:true});
const req=(path,body)=>fetch(base+'/v1'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json','idempotency-key':randomUUID()},...(body?{body:JSON.stringify(body)}:{})});
const credentials={email:randomUUID()+'@example.invalid',password:randomBytes(24).toString('base64url')};
{const code=new URL(app.service.passwords.issue(user.id).url).hash.slice(7);const r=await fetch(base+'/v1/auth/setup',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({...credentials,code})});assert.equal(r.status,200);}
const draft=async instruction=>{const r=await req('/phone/draft',{phone:number,name:'設定済みの発信元',instruction});assert.equal(r.status,201);return (await r.json()).mission.id;};
const turns=[['callee','はい、お電話ありがとうございます。'],['caller','もしもし。AIによる代理のお電話です。9月25日の19時に2名で空きがあるか伺えますか。'],['callee','19時は満席ですが、19時半でしたら空いております。'],['caller','19時半ですね。未確認の提案として依頼者に伝えます。ありがとうございます。'],['callee','はい、お待ちしております。']];
const store=(id,status,count)=>{const m=app.store.get('mission',id);m.status=status;m.approvedAt=Date.now();if(status!=='ACTIVE')m.finishedAt=Date.now();m.transcript=turns.slice(0,count).map(([source,text],i)=>({id:'state-'+i,source,text,t:(i+1)*4000}));app.store.put('mission',m);return m;};
let page;
try{
 const running=await draft('9月25日の19時に2名の空席を確認してください。予約はしないでください。'),ended=await draft('9月25日の19時に2名の空席を確認してください。予約はしないでください。');
 store(running,'ACTIVE',3);const done=store(ended,'INCOMPLETE',5);
 app.store.event(done,{type:'news.lookup',tookMs:5000,result:{status:'verified',topic:'weather',checkedAt:new Date().toISOString(),publishedOn:new Date().toISOString().slice(0,10),text:'表示確認用の固定文です。実際の報道ではありません。',sources:[{title:'表示確認用の出典',url:'https://example.invalid/articles/display-boundary'}]}});
 page=await launch({width:1280,height:900});await page.emulateReducedMotion();await page.goto(base);
 await page.js("document.querySelector('#managed-email').focus()");await page.type(credentials.email);await page.press('Tab');await page.type(credentials.password);await page.press('Enter');await page.until("!document.querySelector('#screen-real').hidden");
 const mask="document.querySelector('#phone-number').type='password';document.querySelector('#phone-live-recipient').textContent='設定済みの発信元（番号は非公開）';document.querySelector('#phone-live').scrollIntoView({block:'start'})";

 await page.goto(base+'/?call='+running);await page.until("document.querySelector('#phone-live-state')?.textContent==='通話中'");
 assert.equal(await page.visible('#phone-hangup'),true);assert.equal(await page.js("document.querySelector('#phone-hangup').disabled"),false);assert.equal(await page.visible('#phone-resolve'),false);
 // A call in progress is not an error and must not read like one.
 assert.equal(await page.visible('#phone-live-error'),false);
 await page.click('#phone-live details:not(#phone-live-request):not(#phone-cost-details) summary');assert.match(await page.text('#phone-live-transcript'),/19時半でしたら空いております/);
 for(const [label,w,h] of [['running',1280,900],['running-mobile',390,844]]){await page.viewport(w,h);await page.js(mask);await sleep(300);assert.ok(await page.noSidewaysScroll());await page.screenshot(join(out,label+'.png'));}

 await page.viewport(1280,900);await page.goto(base+'/?call='+ended);await page.until("document.querySelector('#phone-live-state')?.textContent==='通話終了'");
 assert.equal(await page.visible('#phone-hangup'),false);assert.equal(await page.visible('#phone-live-error'),false);
 // What was confirmed and what is only an offer stay apart, each with the words it came from; nothing claims a booking.
 const memory=await page.text('#phone-memory');assert.match(memory,/予約成立を保証するものではありません/);assert.match(memory,/希望：19:00/);assert.match(memory,/提案・未確認：19:30/);assert.match(memory,/19時半でしたら空いております/);assert.doesNotMatch(memory,/予約が成立|予約できました/);
 // The memo and the sources are results: visible without opening the transcript, and the memo is already open.
 assert.equal(await page.js("document.querySelector('#phone-memory').open&&!document.querySelector('#phone-memory').closest('details:not(#phone-memory)')&&!document.querySelector('#phone-news').closest('details:not(#phone-news)')"),true);assert.equal(await page.visible('#phone-memory blockquote'),true);
 assert.match(await page.text('#phone-news'),/表示確認用の出典/);
 // The offered 19:30 can go to the caller's own calendar, marked as not settled; the file is served only to its owner.
 // The verdict comes before its evidence, and every quote says whose words it is.
 assert.match(await page.text('#phone-memory-verdict'),/確認できたこと：.*まだ決まっていないこと：.*時刻/s);assert.match(await page.text('#phone-memory'),/相手：「19時は満席ですが、19時半でしたら空いております。」|AI：「/);assert.match(await page.text('#phone-memory'),/希望どおりですが、相手の確定はまだです/);
 assert.equal(await page.visible('#phone-calendar'),true);assert.match(await page.text('#phone-memory'),/まだ確定していない日時です/);
 const ics=await req('/phone/calls/'+ended+'/calendar.ics');assert.equal(ics.status,200);assert.match(ics.headers.get('content-type'),/text\/calendar/);const body=await ics.text();
 assert.match(body,/DTSTART;TZID=Asia\/Tokyo:20260925T193000/);assert.match(body,/DTEND;TZID=Asia\/Tokyo:20260925T203000/);assert.match(body,/SUMMARY:【未確定】/);assert.match(body,/STATUS:TENTATIVE/);assert.match(body,/予約の成立を保証するものではありません/);
 assert.equal((await fetch(base+'/v1/phone/calls/'+ended+'/calendar.ics')).status,401);// A call memo without a date and a time has nothing to put on a calendar.
 assert.equal((await req('/phone/calls/'+(await draft('近況を聞いてください。'))+'/calendar.ics')).status,409);
 for(const [label,w,h] of [['ended',1280,900],['ended-mobile',390,844]]){await page.viewport(w,h);await page.js(mask);await sleep(300);assert.ok(await page.noSidewaysScroll());await page.screenshot(join(out,label+'.png'));}
 // The rest of the result: add-to-calendar and the looked-up sources.
 for(const [label,w,h] of [['ended-lower',1280,900],['ended-lower-mobile',390,844]]){await page.viewport(w,h);await page.js("document.querySelector('#phone-news').open=true;document.querySelector('#phone-calendar').scrollIntoView({block:'center'})");await sleep(300);await page.screenshot(join(out,label+'.png'));}
 assert.deepEqual(page.pageErrors,[]);
 // Reading a record never starts or repeats a call.
 assert.equal(app.store.list('mission',user.id,'QUEUED').length,0);
 console.log('PASS: in-progress and normally ended call screens, stop control, separated confirmed/offered conditions with quotes, news source, mobile/desktop; no phone calls');
}finally{await page?.close();await app.close();rmSync(dir,{recursive:true,force:true});}
