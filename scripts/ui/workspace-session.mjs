// Real session continuity through the detailed-settings screen. No fabricated records or provider calls.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {join, resolve} from 'node:path';
import {launch} from './cdp.mjs';

const {values}=parseArgs({options:{url:{type:'string'},token:{type:'string'},output:{type:'string'}}});
const origin=new URL(values.url);
assert(origin.protocol==='http:'&&['127.0.0.1','localhost'].includes(origin.hostname),'Only an isolated loopback preview');
const token=readFileSync(values.token,'utf8').trim(),out=resolve(values.output);
const paths=['apps/gateway/public/index.html','apps/gateway/public/app.js','apps/gateway/public/style.css'];
const hashes=()=>Object.fromEntries(paths.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
const report={at:new Date().toISOString(),method:'Real Chrome, existing operator credentials, native session cookies, actual pointer input; no business-record mutations',sourceHashes:hashes(),checks:[],screenshots:[]};
const p=await launch();
const check=(value,name)=>{assert(value,name);report.checks.push(name);};
const signedIn=()=>p.until("!document.getElementById('workspace').hidden");
const authenticate=()=>p.js(`fetch('/v1/session',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+${JSON.stringify(token)}},body:'{}'}).then(r=>r.status)`);
try {
  await p.goto(origin.origin+'/workspace');
  check(await p.visible('#login'),'Unauthenticated user has a login path');
  check(await p.js("document.querySelector('.workspace-login').getAttribute('href')==='/app/#login'"),'Email login returns to the shared login screen');
  await p.tap('#token');await p.type(token);await p.tap('#login-form button[type=submit]');await signedIn();
  check(await p.js("document.getElementById('token').value===''"),'Credential input cleared after session creation');
  check(await p.js("fetch('/v1/bootstrap').then(r=>r.status===200)"),'Native cookie authenticates without a Bearer header');
  await p.goto(origin.origin+'/workspace');await signedIn();
  check(await p.js("document.getElementById('login').hidden"),'Reload inherits the existing app session without token re-entry');
  check(await p.text('#mode')==='事前プレリリース・受付停止中','Paused prerelease is visible');
  check((await p.text('#readiness')).includes('新しい発信を停止'),'Preparation does not claim calling is available');
  for(const width of [1440,390]){
    await p.viewport(width,900);await p.goto(origin.origin+'/workspace');await signedIn();
    check(await p.noSidewaysScroll(),`Workspace has no horizontal overflow at ${width}px`);
    await p.js(`(()=>{for(const n of document.querySelectorAll('input,select,textarea,#history,#detail,#caller-state'))n.style.setProperty('visibility','hidden','important');const n=document.createElement('p');n.textContent='検証画像：既存記録の個人情報は撮影時だけ非表示（レイアウト保持）';n.style.cssText='position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#fff;color:#111;padding:8px;font-size:12px;margin:0';document.body.append(n)})()`);
    const file=`workspace-after-${width}.png`;await p.screenshot(join(out,file));
    report.screenshots.push({file,width,privacy:'Inputs, selects, transcript/history content hidden only for this screenshot. Actual API data and layout retained; not evidence of data typography.'});
  }
  await p.goto(origin.origin+'/workspace');await signedIn();
  await p.tap('.workspace-back');await p.until("location.pathname==='/app/'&&location.hash==='#settings/view'");
  check(await p.js("fetch('/v1/bootstrap').then(r=>r.status===200)"),'Return to app settings retains authentication');
  await p.goto(origin.origin+'/workspace');await signedIn();await p.tap('#logout');
  await p.until("location.pathname==='/app/'&&location.hash==='#login'");
  check(await p.js("fetch('/v1/bootstrap').then(r=>r.status===401)"),'Logout revokes the shared server session');
  check(await authenticate()===200,'Existing operator can authenticate again');
  await p.goto(origin.origin+'/workspace');await signedIn();
  check(await p.js("fetch('/v1/session',{method:'DELETE'}).then(r=>r.status===200)"),'Session invalidation comes from the actual server');
  await p.tap('#refresh');await p.until("location.pathname==='/app/'&&location.hash==='#login'");
  check(true,'Expired session returns to shared login');
  report.runtimeExceptions=p.pageErrors.filter(e=>!e.startsWith('console.error:'));
  check(report.runtimeExceptions.length===0,'No runtime exceptions');
  check(JSON.stringify(hashes())===JSON.stringify(report.sourceHashes),'Workspace source remained unchanged during verification');
  writeFileSync(join(out,'workspace-after.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.checks.length,evidence:join(out,'workspace-after.json')}));
}finally {await p.close()}
