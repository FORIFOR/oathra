// Read-only capture of existing records. Privacy overlays affect only this temporary browser.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { launch, sleep } from '../../../../scripts/ui/cdp.mjs';

const origin = 'http://127.0.0.1:61758';
const base = new URL('./', import.meta.url);
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const paths = ['apps/gateway/public/app/app.js', 'apps/gateway/public/app/style.css', 'apps/gateway/public/app/index.html'];
const report = { observedAt: new Date().toISOString(), origin, method: 'Actual Chrome pointer navigation with real existing operator; no business mutations', sourceHashes: Object.fromEntries(paths.map(p => [p,hash(p)])), views: [], actions: [] };
const page = await launch();
const redact = async () => page.js(`(() => {
  window.__privacyObserver?.disconnect();
  const allow = new Set(['ホーム','最近の電話','話しました','設定','依頼','報告を開く','同じ相手にまた頼む','すべての依頼','クレジットと費用','本番の電話','クレジット残高','今月の電話','前回かけた電話','Oathra がすること','通話時間','話した内容の記録','話したことの記録','文字起こし','AI','相手','かける設定']);
  const apply = () => {
    const main = document.querySelector('main'); if (!main) return;
    const texts=[]; const w=document.createTreeWalker(main,NodeFilter.SHOW_TEXT); let n;
    while(n=w.nextNode()) { const t=n.textContent.trim(); if (!t || n.parentElement.closest('[data-review-mask],script,style') || allow.has(t) || n.parentElement.closest('.metric-v')) continue; texts.push(n); }
    for(const n of texts){ const span=document.createElement('span'); span.dataset.reviewMask='true'; span.style.setProperty('color','transparent','important'); span.style.setProperty('text-shadow','none','important'); span.style.setProperty('background-color','#ced8d2','important'); span.style.setProperty('border-radius','2px','important'); n.replaceWith(span); span.append(n); }
  };
  apply(); window.__privacyObserver=new MutationObserver(apply); window.__privacyObserver.observe(document.querySelector('main'),{childList:true,subtree:true});
  const masks=[...document.querySelectorAll('[data-review-mask]')];
  return { count:masks.length, applied:masks.every(n=>getComputedStyle(n).color==='rgba(0, 0, 0, 0)') };
})()`);
async function capture(name) {
  await sleep(300);
  const privacy=await redact(); if(!privacy.applied) throw new Error('Privacy style not applied');
  for(const width of [1440,390]) {
    await page.viewport(width,width===1440?900:844); await sleep(100);
    if(!await page.js(`[...document.querySelectorAll('[data-review-mask]')].every(n=>getComputedStyle(n).color==='rgba(0, 0, 0, 0)')`))throw new Error('Privacy style changed');
    const filename=`before-${name}-${width}-redacted.png`; await page.screenshot(new URL(filename,base).pathname);
    report.views.push({name,width,screenshot:filename,horizontalOverflow:!(await page.noSidewaysScroll()),privacy:{mode:'CSSOM text masking; static whitelist retained, original text/layout not replaced',maskedTextNodes:privacy.count}});
  }
  await page.viewport(1440,900);
}
try {
  await page.goto(origin+'/app/');
  const token=readFileSync('.oathra/managed-preview/.oathra-managed/admin-token.txt','utf8').trim();
  const status=await page.js(`fetch('/v1/session',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+${JSON.stringify(token)}},body:'{}'}).then(r=>r.status)`); if(status!==200)throw new Error('Existing authentication unavailable');
  await page.goto(origin+'/app/'); await capture('home');
  await page.tap("main a.btn[href^='#/call/']"); await page.until("location.hash.startsWith('#/call/') && !!document.querySelector('.transcript')",{label:'existing report'}); await capture('report');
  report.actions.push({task:'Read existing result and evidence',status:'PASS',observed:'Existing report and two transcript lines accessible; no new record created. This does not establish that the record represents a successful production call.'});
  await page.tap("header a.plain[href='#/settings']"); await page.until("location.hash==='#/settings' && !!document.querySelector('.set-row')",{label:'settings'}); await capture('settings');
  report.actions.push({task:'Find configuration',status:'PASS',observed:'Desktop header Settings opens settings; no setting was saved.'});
  await page.js("fetch('/v1/session',{method:'DELETE'}).then(r=>r.status)");
  report.runtimeExceptions=page.pageErrors.filter(e=>!e.startsWith('console.error:')).length;
  report.sourceUnchanged=paths.every(p=>report.sourceHashes[p]===hash(p));
  writeFileSync(new URL('before-authenticated-captures.json',base),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({views:report.views.length,runtimeExceptions:report.runtimeExceptions,sourceUnchanged:report.sourceUnchanged}));
} finally { await page.close(); }
