// 予約台帳: the restaurant's ledger as its owner sees it. Authenticated Gateway + real SQLite; the worker is NEVER
// started and nothing is dialled. The bookings below are local fixtures for rendering only, never a claim that
// such calls took place.
import assert from 'node:assert/strict';import {randomBytes,randomUUID} from 'node:crypto';import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {createGateway,configuration} from '../../apps/gateway/server.mjs';import {hash} from '../../apps/gateway/lib/security.mjs';import {launch,sleep} from './cdp.mjs';
const dir=mkdtempSync(join(tmpdir(),'oathra-managed-bookings-'));
const owner={id:randomUUID(),team:'bistro',role:'admin',tokenHash:hash(randomBytes(32).toString('hex'))},other={id:randomUUID(),team:'other',role:'operator',tokenHash:hash(randomBytes(32).toString('hex'))};
const restaurant={name:'ビストロ灯',slots:{'18:00':2,'18:30':1,'19:00':2,'19:30':1,'20:00':2,'20:30':1},maxParty:6,closedWeekdays:[],closedDates:[]};
const today=new Date(Date.now()+9*3600_000).toISOString().slice(0,10),plus=n=>new Date(Date.parse(today+'T00:00:00Z')+n*86400_000).toISOString().slice(0,10);
restaurant.closedDates=[plus(3)];
const config=configuration({OATHRA_USERS_JSON:JSON.stringify([owner,other]),OATHRA_DATA_KEY:randomBytes(32).toString('hex'),OATHRA_DB:join(dir,'db.sqlite'),OATHRA_DEPLOYMENT:'managed',OATHRA_CREDITS_PER_CALL:'3',OATHRA_INBOUND_OWNER:owner.id,OATHRA_RESTAURANT_JSON:JSON.stringify(restaurant)});
const app=await createGateway(config,{env:{}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;config.publicUrl=base;
const out=resolve(process.env.UI_EVIDENCE_DIR??'artifacts/quality/managed-bookings');mkdirSync(out,{recursive:true});
const credentials=async user=>{const c={email:randomUUID()+'@example.invalid',password:randomBytes(24).toString('base64url')},code=new URL(app.service.passwords.issue(user.id).url).hash.slice(7);
 const r=await fetch(base+'/v1/auth/setup',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({...c,code})});assert.equal(r.status,200);return c;};
const ownerLogin=await credentials(owner),otherLogin=await credentials(other);
// The call a booking came from, so the arrow has somewhere real to go.
const call={id:randomUUID(),owner:owner.id,team:owner.team,revision:1,status:'INCOMPLETE',kind:'phone-request',direction:'inbound',goal:'phone.reception',mode:'live',target:{name:'着信',phone:'+819000000000'},request:'着信（予約受付）の応対',
 phoneRequest:{schemaVersion:1,kind:'oathra.phone-request',phone:'+819000000000',name:'着信',instruction:'着信。店の予約受付として応対し、席の予約を台帳に記録します。'},inbound:{reception:true,ownerName:restaurant.name},createdAt:Date.now(),approvedAt:Date.now(),finishedAt:Date.now(),
 transcript:[['caller','お電話ありがとうございます。ビストロ灯です。AIが受付をしております。ご予約でしょうか？'],['callee','今日の19時半に2名でお願いします。'],['caller','本日の19時半、2名様、田中様でよろしいでしょうか？'],['callee','はい。']].map(([source,text],i)=>({id:'fixture-'+i,source,text,t:(i+1)*4000}))};
app.store.put('mission',call);
const seed=(date,time,partySize,name,callId=randomUUID())=>app.store.put('table-booking',{id:randomUUID(),owner:owner.id,team:owner.team,status:'booked',date,time,partySize,name,callId,phone:'+819000000000',createdAt:Date.now()});
const login=async(page,c)=>{await page.goto(base);await page.js("document.querySelector('#managed-email').focus()");await page.type(c.email);await page.press('Tab');await page.type(c.password);await page.press('Enter');await page.until("document.body.classList.contains('managed-signed-in')");};
const shot=async(page,label,w,h)=>{await page.viewport(w,h);await sleep(350);assert.ok(await page.noSidewaysScroll(),label+' scrolls sideways');await page.screenshot(join(out,label+'.png'));};
// The managed board fixes the window and scrolls <main>; "fits one window" is measured there, not on the document.
const fits=page=>page.js("(()=>{const m=document.querySelector('main');return m.scrollHeight<=m.clientHeight+2&&document.documentElement.scrollHeight<=innerHeight+2})()");
let page;
try{
 page=await launch({width:1280,height:900});await page.emulateReducedMotion();
 // Someone whose account is not the restaurant's never sees the ledger, in the header or over the API.
 await login(page,otherLogin);assert.equal(await page.visible('#bookings-open'),false);
 assert.deepEqual(await page.js("fetch('/v1/phone/bookings',{credentials:'same-origin'}).then(r=>r.json()).then(d=>({restaurant:d.restaurant,count:d.bookings.length}))"),{restaurant:null,count:0});
 await page.close();page=await launch({width:1280,height:900});await page.emulateReducedMotion();

 // Empty ledger: the screen says how bookings get here, not just that there are none.
 await login(page,ownerLogin);assert.equal(await page.visible('#bookings-open'),true);
 await page.click('#bookings-open');await page.until("document.querySelector('#bookings-board .bk-slot')");
 assert.match(await page.text('#bookings-summary'),/まだありません。店の番号に電話がかかり、AIが予約を受けるとここに並びます/);assert.equal(await page.js("document.querySelector('#bookings-open').getAttribute('aria-pressed')"),'true');
 await shot(page,'empty',1280,800);

 seed(today,'19:30',2,'田中',call.id);seed(today,'19:00',4,'佐藤');seed(today,'19:00',2,'長谷川・ウィリアムズ 友紀子（取引先様ご接待）');seed(today,'20:00',6,'鈴木');
 seed(plus(1),'18:00',2,'高橋');seed(plus(9),'20:30',3,'伊藤');seed(plus(-1),'19:00',2,'過去の予約');
 await page.click('#bookings-refresh');await page.until("document.querySelectorAll('#bookings-board .bk-booking').length===4");
 assert.match(await page.text('#bookings-summary'),/これからの予約は6件、19名です/);assert.doesNotMatch(await page.text('#screen-bookings'),/過去の予約|\+81|9000/);
 // A full seating says so in words, and what is left is counted per seating.
 assert.match(await page.js("[...document.querySelectorAll('.bk-slot')].map(li=>li.querySelector('.bk-time').textContent+' '+li.querySelector('.bk-left').textContent).join('|')"),/18時 残り2卓\|18時半 残り1卓\|19時 満席\|19時半 満席\|20時 残り1卓\|20時半 残り1卓/);
 assert.deepEqual(await page.smallTargets(44),[]);
 assert.match(await page.text('#bookings-checked'),/^\d{1,2}時\d{2}分に確認$/);
 // One window, at the smallest laptop the brief names.
 await page.viewport(1280,800);await sleep(300);assert.ok(await fits(page),'the day does not fit one 1280x800 window');
 await shot(page,'today',1280,800);await shot(page,'today-mobile',390,844);await page.js("[...document.querySelectorAll('.bk-slot')][2].scrollIntoView({block:'start'})");await sleep(300);await page.screenshot(join(out,'today-mobile-lower.png'));await page.js('scrollTo(0,0)');await page.viewport(1280,800);

 // "/" goes to the search; typing narrows the names and leaves the seat counts alone.
 await page.js("document.activeElement.blur()");await page.press('/');
 await page.js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'/',bubbles:true,cancelable:true}))");
 assert.equal(await page.js("document.activeElement.id"),'bookings-search');await page.type('佐藤');await sleep(200);
 assert.equal(await page.js("document.querySelectorAll('#bookings-board .bk-booking').length"),1);assert.match(await page.text('#bookings-board'),/該当なし/);assert.match(await page.text('#bookings-board'),/満席/);
 assert.match(await page.text('#bookings-day-note'),/^この日に1件。$/);assert.match(await page.text('#bookings-days'),/今日該当1件明日該当なし/);
 await shot(page,'search',1280,800);
 // The name is looked for on every day, and the screen says where it is when it is not on this one.
 const search=async q=>{await page.js(`(()=>{const i=document.querySelector('#bookings-search');i.value=${JSON.stringify(q)};i.dispatchEvent(new Event('input',{bubbles:true}))})()`);await sleep(200);};
 await search('高橋');assert.match(await page.text('#bookings-day-note'),/この日にはありません。ほかに 明日 にあります。/);assert.equal(await page.js("document.querySelectorAll('.bk-daychip.bk-dim').length"),7);await shot(page,'search-elsewhere',1280,800);
 await search('該当しない名前');assert.match(await page.text('#bookings-day-note'),/「該当しない名前」に一致する予約は、これからの予約の中にありません。/);await shot(page,'search-none',1280,800);
 await page.js("(()=>{const i=document.querySelector('#bookings-search');i.value='';i.dispatchEvent(new Event('input',{bubbles:true}))})()");

 // Another day, a closed day, and a day beyond the week that has a booking.
 assert.equal(await page.js("document.querySelectorAll('.bk-daychip').length"),8);
 // Chosen with the keyboard, a day keeps the keyboard: Enter on a chip, and the focus is on that same day afterwards.
 await page.js("document.querySelectorAll('.bk-daychip')[1].focus()");await page.press('Enter');
 assert.deepEqual(await page.js("(()=>{const a=document.activeElement;return [a.className,a.getAttribute('aria-pressed'),a.textContent.slice(0,2)]})()"),['bk-daychip','true','明日']);assert.match(await page.text('#bookings-board'),/高橋 様/);
 await page.press('Tab');assert.equal(await page.js("document.activeElement===document.querySelectorAll('.bk-daychip')[2]"),true);
 // A closed day offers no tables: no counts, no dots.
 await page.js("document.querySelectorAll('.bk-daychip')[3].click()");await sleep(200);assert.match(await page.text('#bookings-day-note'),/休業日です。AIは予約を受けません/);
 assert.match(await page.text('#bookings-board'),/^休業日のため、この日の席は表示していません。$/);assert.equal(await page.js("document.querySelectorAll('#bookings-board .bk-seats').length"),0);await shot(page,'closed-day',1280,800);
 await page.js("document.querySelectorAll('.bk-daychip')[7].click()");await sleep(200);assert.match(await page.text('#bookings-board'),/伊藤 様/);

 // A failed load says what to do and keeps what was on screen; the next try recovers.
 await page.goto(base);await page.until("document.body.classList.contains('managed-signed-in')");await page.click('#bookings-open');await page.until("document.querySelectorAll('#bookings-board .bk-booking').length===4");
 await page.js("window.__fetch=window.fetch;window.fetch=(u,o)=>String(u).includes('/phone/bookings')?Promise.reject(new TypeError('offline')):window.__fetch(u,o)");
 await page.click('#bookings-refresh');await page.until("!document.querySelector('#bookings-error').hidden");assert.match(await page.text('#bookings-error'),/読み込めませんでした。通信を確かめて/);assert.equal(await page.js("document.querySelectorAll('#bookings-board .bk-booking').length"),4);
 assert.ok(await fits(page),'the failed load does not fit one 1280x800 window');await shot(page,'error',1280,800);
 await page.js("window.fetch=window.__fetch");await page.click('#bookings-refresh');await page.until("document.querySelector('#bookings-error').hidden");

 // A restaurant with a long evening: the list scrolls inside its frame, the page still does not.
 const few=config.inbound.restaurant.slots;config.inbound.restaurant.slots=Object.fromEntries(Array.from({length:14},(_,i)=>[`${String(11+Math.floor(i/2)).padStart(2,'0')}:${i%2?'30':'00'}`,2]));// 11:00-17:30: the evening bookings are now outside the settings
 await page.click('#bookings-refresh');await page.until("document.querySelectorAll('#bookings-board .bk-slot').length===17");assert.match(await page.text('#bookings-board'),/19時半いまは受け付けていない時刻田中 様/);assert.ok(await fits(page),'a long evening makes the page scroll');
 // It opens on the first booking, says there is more below, and the footnote is still inside the window.
 assert.equal(await page.js("(()=>{const l=document.querySelector('.bk-slots'),b=document.querySelector('.bk-booking').getBoundingClientRect(),r=l.getBoundingClientRect();return l.scrollHeight>l.clientHeight&&l.tabIndex===0&&b.top>=r.top&&b.bottom<=r.bottom})()"),true);
 assert.equal(await page.js("document.querySelector('.bk-foot').getBoundingClientRect().bottom<=innerHeight"),true);await shot(page,'long-evening',1280,800);
 await page.js("window.__fetch=window.fetch;window.fetch=(u,o)=>String(u).includes('/phone/bookings')?Promise.reject(new TypeError('offline')):window.__fetch(u,o)");await page.click('#bookings-refresh');await page.until("!document.querySelector('#bookings-error').hidden");
 assert.ok(await fits(page),'a long evening with a failed load makes the page scroll');await sleep(200);assert.equal(await page.js("(()=>{const b=document.querySelector('#bookings-board');return b.classList.contains('bk-more')&&b.classList.contains('bk-above')})()"),true,'the shrunken list does not say that it continues');assert.equal(await page.js("document.querySelector('.bk-foot').getBoundingClientRect().bottom<=innerHeight"),true);await shot(page,'long-evening-error',1280,800);await page.js("window.fetch=window.__fetch");
 config.inbound.restaurant.slots=few;await page.click('#bookings-refresh');await page.until("document.querySelectorAll('#bookings-board .bk-slot').length===6");

 // The arrow opens the call the booking came from, with the ledger's record on it.
 await page.js("[...document.querySelectorAll('.bk-booking')].find(b=>b.textContent.includes('田中')).click()");await page.until("!document.querySelector('#screen-real').hidden&&document.querySelector('#phone-live-state')?.textContent==='通話終了'");
 assert.equal(await page.js("document.querySelector('#bookings-open').getAttribute('aria-pressed')"),'false');
 assert.deepEqual(page.pageErrors.filter(e=>!/offline/.test(e)),[]);
 assert.equal(app.store.list('mission',owner.id,'QUEUED').length,0);
 console.log('PASS: bookings ledger — hidden from other accounts, empty, populated, full seatings, search with "/", search across days, keyboard day choice, closed day, far day, long evening, load failure and recovery, open the call; mobile/desktop; no phone calls');
}finally{await page?.close();await app.close();rmSync(dir,{recursive:true,force:true});}
