// Read-only real-browser review. Existing records only; screenshot text is privacy-masked.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { launch, sleep } from '../../../../scripts/ui/cdp.mjs';
const origin=process.env.REVIEW_ORIGIN??'http://127.0.0.1:61758';
const label=process.env.REVIEW_LABEL??'round-a';
const base=new URL('./',import.meta.url);
const sourcePaths=['apps/gateway/public/app/app.js','apps/gateway/public/app/style.css','apps/gateway/public/app/index.html','apps/gateway/public/phone/public-service.js','apps/gateway/public/phone/public-service.css','apps/gateway/public/phone/account.js'];
const digest=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const hashes=()=>Object.fromEntries(sourcePaths.map(p=>[p,digest(p)]));
const appSource=readFileSync(sourcePaths[0],'utf8');
const literals=[...appSource.matchAll(/\btext:\s*'([^'\\]*)'/g)].map(m=>m[1]);
const allow=[...new Set([...literals,'かける設定','かけられた時の設定','商品（営業の電話）','費用とクレジット','声とAI','記録と表示','今日','今週','すべて','確認が必要','完了','予定','失敗','取消','受付停止中','相手','AI','話しました','Oathra がすること','3分で切ります'])];
const report={observedAt:new Date().toISOString(),origin,label,method:'Existing operator and existing business records; no form save, playback, phone, email or payment action',sourceHashes:hashes(),views:[],limitations:['Private record text and nonempty field values hidden with verified CSSOM masking; content layout preserved, some generic text also hidden.','Successful new request, business approval, live calling, payment, email and persistence are not exercised.']};
const page=await launch();
async function mask(){
 return page.js(`(()=>{
  const allow=new Set(${JSON.stringify(allow)});window.__reviewPrivacy?.disconnect();
  const apply=()=>{const main=document.querySelector('main');if(!main)return;
   const texts=[];const walk=document.createTreeWalker(main,NodeFilter.SHOW_TEXT);let n;
   while(n=walk.nextNode()){const t=n.textContent.trim();if(!t||allow.has(t)||n.parentElement.closest('[data-review-mask],script,style'))continue;texts.push(n);}
   for(const n of texts){const s=document.createElement('span');s.dataset.reviewMask='true';s.style.setProperty('color','transparent','important');s.style.setProperty('text-shadow','none','important');s.style.setProperty('background-color','#cbd5cf','important');s.style.setProperty('border-radius','2px','important');n.replaceWith(s);s.append(n);}
   for(const input of main.querySelectorAll('input:not([type=checkbox]):not([type=radio]),textarea,select'))if(input.value){input.dataset.reviewPrivateValue='true';input.style.setProperty('color','transparent','important');input.style.setProperty('text-shadow','none','important');input.style.setProperty('caret-color','transparent','important');}
  };apply();window.__reviewPrivacy=new MutationObserver(apply);window.__reviewPrivacy.observe(document.querySelector('main'),{childList:true,subtree:true});
  const hidden=[...document.querySelectorAll('[data-review-mask],[data-review-private-value]')];return {count:hidden.length,applied:hidden.every(n=>getComputedStyle(n).color==='rgba(0, 0, 0, 0)')};
 })()`);
}
try{
 await page.goto(origin+'/app/');const token=readFileSync('.oathra/managed-preview/.oathra-managed/admin-token.txt','utf8').trim();
 if(await page.js(`fetch('/v1/session',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+${JSON.stringify(token)}},body:'{}'}).then(r=>r.status)`)!==200)throw new Error('Existing authentication unavailable');
 await page.goto(origin+'/app/');let reportHash=await page.js(`document.querySelector("main a[href^='#/call/']")?.getAttribute('href')`);
 if(process.env.REVIEW_REPORT_NOTES==='1') reportHash=await page.js("fetch('/v1/phone/history').then(r=>r.json()).then(rows=>{const r=rows.find(r=>r.memory?.notes?.length&&!['dialing','connected','running'].includes(r.state));return r?'#/call/'+r.id:null})");
 const routes=[['home','#/'],['new','#/new'],['requests','#/requests'],...(reportHash?[['report',reportHash]]:[]),['schedule','#/schedule'],['practice','#/practice'],['contacts','#/contacts'],...['out','in','products','cost','voice','view'].map(t=>['settings-'+t,'#/settings/'+t])];
 for(const [name,route]of routes.filter(([name])=>!process.env.REVIEW_ONLY||process.env.REVIEW_ONLY.split(',').includes(name))){
  await page.goto(origin+'/app/'+route);await sleep(350);
  for(const width of (process.env.REVIEW_WIDTHS??'1440,390').split(',').map(Number)){
   await page.viewport(width,width===1440?900:844);await sleep(100);
   const before=await page.js(`(()=>{const allowed=new Set(${JSON.stringify(allow)});const main=document.querySelector('main');return {h1:[...main.querySelectorAll('h1')].map(n=>allowed.has(n.textContent.trim())?n.textContent.trim():'[private heading]'),h2:[...main.querySelectorAll('h2')].map(n=>allowed.has(n.textContent.trim())?n.textContent.trim():'[private heading]'),emptyError:!!main.querySelector('.errbox'),itemCount:main.querySelectorAll('.item,.row').length,transcriptLines:main.querySelectorAll('.transcript .line').length,inputs:[...main.querySelectorAll('input:not([type=hidden]),textarea,select')].map(n=>({type:n.type,id:n.id,disabled:n.disabled,hasAccessibleLabel:!!(n.labels?.length||n.getAttribute('aria-label')||n.getAttribute('aria-labelledby'))})),transcriptLayout:main.querySelector('.transcript')?{justifyContent:getComputedStyle(main.querySelector('.transcript')).justifyContent,top:main.querySelector('.transcript').getBoundingClientRect().top,firstLineTop:main.querySelector('.transcript .line')?.getBoundingClientRect().top}:null,topNavVisible:[...document.querySelectorAll('#tabs [data-tab]')].map(n=>({tab:n.dataset.tab,fullyInViewport:n.getBoundingClientRect().left>=0&&n.getBoundingClientRect().right<=innerWidth}))};})()`);
   const privacy=await mask();if(!privacy.applied)throw new Error('Privacy masking failed');
   const capture = !process.env.REVIEW_CAPTURE_NAMES || process.env.REVIEW_CAPTURE_NAMES.split(',').includes(name);
   const screenshot=capture&&width!==320?`${label}-${name}-${width}-redacted.png`:null;if(screenshot)await page.screenshot(new URL(screenshot,base).pathname);
   const layout=await page.js('({clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,innerWidth,visualViewportWidth:visualViewport.width})');
   report.views.push({name,width,screenshot,layout,horizontalOverflow:layout.scrollWidth>width+1||layout.scrollWidth>layout.clientWidth+1,privacy,...before});
  }
  await page.viewport(1440,900);
 }
 report.runtimeExceptions=page.pageErrors.filter(e=>!e.startsWith('console.error:')).length;report.sourceUnchanged=JSON.stringify(report.sourceHashes)===JSON.stringify(hashes());
 await page.js("fetch('/v1/session',{method:'DELETE'}).then(r=>r.status)");writeFileSync(new URL(`${label}-routes.json`,base),JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({views:report.views.length,overflows:report.views.filter(v=>v.horizontalOverflow).map(v=>v.name+':'+v.width),runtimeExceptions:report.runtimeExceptions,sourceUnchanged:report.sourceUnchanged,unlabelledInputs:report.views.flatMap(v=>v.inputs.filter(i=>!i.hasAccessibleLabel).map(i=>({view:v.name,width:v.width,...i})))}));
}finally{await page.close();}
