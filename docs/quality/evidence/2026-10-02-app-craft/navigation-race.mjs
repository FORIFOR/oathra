// Real network latency and navigation only. Existing operator; no records written.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { launch, sleep } from '../../../../scripts/ui/cdp.mjs';
const origin='http://127.0.0.1:61758', source='apps/gateway/public/app/app.js';
const hash=()=>createHash('sha256').update(readFileSync(source)).digest('hex');
const report={observedAt:new Date().toISOString(),method:'Actual Chrome CDP Network.emulateNetworkConditions, 800ms latency; first route hash and pending Fetch completion observed; real pointer navigation; no response interception',sourceHash:hash(),cases:[]};
const OriginalWebSocket=globalThis.WebSocket;let socket;
globalThis.WebSocket=class extends OriginalWebSocket { constructor(...args){super(...args);socket=this;} };
const page=await launch();globalThis.WebSocket=OriginalWebSocket;
let sequence=-1;const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=sequence--;const listener=e=>{const m=JSON.parse(e.data);if(m.id!==id)return;socket.removeEventListener('message',listener);m.error?reject(new Error(m.error.message)):resolve(m.result);};socket.addEventListener('message',listener);socket.send(JSON.stringify({id,method,params}));});
const pending=new Set();let fetchCount=0;socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Network.requestWillBeSent'&&['Fetch','XHR'].includes(m.params.type)){pending.add(m.params.requestId);fetchCount++;}if(['Network.loadingFinished','Network.loadingFailed'].includes(m.method))pending.delete(m.params.requestId);});
try{
 await page.goto(origin+'/app/');const token=readFileSync('.oathra/managed-preview/.oathra-managed/admin-token.txt','utf8').trim();
 if(await page.js(`fetch('/v1/session',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+${JSON.stringify(token)}},body:'{}'}).then(r=>r.status)`)!==200)throw new Error('Authentication unavailable');
 await cdp('Network.enable');
 for(const [name,selector,firstRoute] of [['cost_then_home',"main a[href='#/settings/cost']",'#/settings/cost'],['new_then_home',"header a[href='#/new']",'#/new']]){
  await cdp('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await page.goto(origin+'/app/');await page.until("document.querySelector('main h1')?.textContent.trim()==='ホーム'",{label:'home loaded'});
  await cdp('Network.emulateNetworkConditions',{offline:false,latency:800,downloadThroughput:128000,uploadThroughput:128000});
  const initialCount=fetchCount;await page.js(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
  await page.tap(selector);await page.until(`location.hash===${JSON.stringify(firstRoute)}`,{timeout:5000,label:'first navigation observed'});await sleep(100);await page.tap("nav a[href='#/']");
  await sleep(1000);for(let i=0;i<30&&pending.size;i++)await sleep(500);await sleep(500);
  const observed=await page.js(`(()=>{const title=document.querySelector('main h1')?.textContent.trim();return {routeIsHome:location.hash==='#/',renderedTitle:['ホーム','電話を頼む','設定','費用とクレジット'].includes(title)?title:'[unclassified title]',renderedHome:title==='ホーム'};})()`);
  report.cases.push({id:name,status:observed.routeIsHome&&observed.renderedHome?'PASS':'FAIL',expected:'Home navigation wins after older asynchronous route work settles',observed:{...observed,firstRouteObserved:true,fetchesSinceFirstNavigation:fetchCount-initialCount,pendingFetches:pending.size}});
 }
 await cdp('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
 await page.js("fetch('/v1/session',{method:'DELETE'}).then(r=>r.status)");
 report.sourceUnchanged=report.sourceHash===hash();report.runtimeExceptions=page.pageErrors.filter(x=>!x.startsWith('console.error:')).length;
 writeFileSync(new URL(process.env.REVIEW_OUTPUT??'navigation-race-observed.json',import.meta.url),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));
}finally{await page.close();}
