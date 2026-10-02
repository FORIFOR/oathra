// Actual browser offline/recovery and existing cookie navigation. No business mutations.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {launch,sleep} from '../../../../scripts/ui/cdp.mjs';
const origin='http://127.0.0.1:61758', paths=['apps/gateway/public/app/app.js','apps/gateway/public/app.js','apps/gateway/public/index.html'];
const hashes=()=>Object.fromEntries(paths.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));
const evidence={observedAt:new Date().toISOString(),method:'Real Chrome pointer navigation, actual Network.emulateNetworkConditions offline and online; existing operator session only. No response interception, no fabricated records.',sourceBefore:hashes(),checks:[]};
const Original=globalThis.WebSocket;let socket;globalThis.WebSocket=class extends Original{constructor(...a){super(...a);socket=this;}};const page=await launch();globalThis.WebSocket=Original;
let serial=-1;const cdp=(method,params={})=>new Promise((res,rej)=>{const id=serial--;const l=e=>{const m=JSON.parse(e.data);if(m.id!==id)return;socket.removeEventListener('message',l);m.error?rej(Error(m.error.message)):res(m.result);};socket.addEventListener('message',l);socket.send(JSON.stringify({id,method,params}));});
const check=(id,expected,observed,pass)=>evidence.checks.push({id,expected,observed,status:pass?'PASS':'FAIL'});
try{
 await page.goto(origin+'/app/');const token=readFileSync('.oathra/managed-preview/.oathra-managed/admin-token.txt','utf8').trim();
 if(await page.js(`fetch('/v1/session',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+${JSON.stringify(token)}},body:'{}'}).then(r=>r.status)`)!==200)throw Error('Authentication unavailable');
 await page.goto(origin+'/app/');await page.until("document.querySelector('main h1')?.textContent.trim()==='ホーム'",{label:'actual home'});
 await cdp('Network.enable');await cdp('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});
 await page.tap("header a[href='#/new']");await page.until("!!document.querySelector('main .errbox')",{timeout:5000,label:'actual network error'});
 const error=await page.js(`(()=>{const b=document.querySelector('main .errbox');return {visible:!!b&&b.offsetHeight>0,message:b?.textContent,actionCount:document.querySelectorAll('main a,main button').length,retryExists:[...document.querySelectorAll('main button,main a')].some(n=>/再読み|もう一度|再試行/.test(n.textContent))};})()`);
 check('offline_route_failure_has_recovery_action','Readable network failure and direct retry control',error,error.visible&&error.retryExists);
 await cdp('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
 if(error.retryExists){await page.js("[...document.querySelectorAll('main button,main a')].find(n=>/再読み|もう一度|再試行/.test(n.textContent)).click()");}
 else{await page.tap("nav a[href='#/']");await page.until("document.querySelector('main h1')?.textContent.trim()==='ホーム'",{label:'home after reconnect'});await page.tap("header a[href='#/new']");}
 await page.until("document.querySelector('main h1')?.textContent.trim()==='電話を頼む'",{label:'actual online new form'});
 check('online_navigation_recovers','Existing session can return to request form after network reconnect',{formVisible:true,usedDirectRetry:error.retryExists},true);
 await page.goto(origin+'/workspace');await page.until("!document.querySelector('#workspace').hidden",{label:'inherited workspace cookie'});
 const legacy=await page.js("({loginHidden:document.querySelector('#login').hidden,workspaceVisible:!document.querySelector('#workspace').hidden,logoutVisible:!document.querySelector('#logout').hidden})");
 check('workspace_existing_cookie','Existing app session opens workspace without token re-entry',legacy,legacy.loginHidden&&legacy.workspaceVisible&&legacy.logoutVisible);
 await page.tap('.workspace-back');await page.until("document.querySelector('.settings-content')?.textContent.includes('記録と表示')",{label:'actual settings view content'});
 const back=await page.js("({route:location.hash,actualSettingsContent:document.querySelector('.settings-content')?.textContent.includes('記録と表示'),loginAbsent:!document.querySelector('#public-login-form')})");
 check('workspace_back_actual_settings','Back link renders authenticated 記録と表示 panel',back,back.actualSettingsContent);
 await page.js("fetch('/v1/session',{method:'DELETE'}).then(r=>r.status)");
 evidence.runtimeExceptionCount=page.pageErrors.filter(s=>!s.startsWith('console.error:')).length;
 evidence.sourceAfter=hashes();evidence.sourceUnchanged=JSON.stringify(evidence.sourceBefore)===JSON.stringify(evidence.sourceAfter);
 evidence.limitations=['Offline applies to browser transport only; no provider failure is simulated.','No business, customer, product, mission, payment or email records created.','No mobile hardware or screen-reader test.'];
 writeFileSync(new URL(process.env.REVIEW_OUTPUT??'app-independent-interactions.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(evidence));
}finally{await cdp('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1}).catch(()=>{});await page.close();}
