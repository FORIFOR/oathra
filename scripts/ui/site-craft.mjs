import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,existsSync,statSync} from 'node:fs';
import {resolve,extname,join} from 'node:path';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {launch} from './cdp.mjs';

const {values}=parseArgs({options:{stage:{type:'string',default:'before'},live:{type:'boolean',default:false}}});
assert(/^(?:before|after-[a-z][a-z0-9-]{0,40})$/.test(values.stage), 'Use before or a unique after-<name> stage.');
const root=resolve('site'),out=resolve('docs/quality/evidence/2026-10-02-craft');mkdirSync(out,{recursive:true});
const output=join(out,`site-${values.stage}.json`);assert(!existsSync(output),'Choose a new stage; existing evidence must remain.');
const report={capturedAt:new Date().toISOString(),stage:values.stage,source:'Public saved Arena negotiation only; no invented data or real phone call.',checks:[],screenshots:[]};
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.mp4':'video/mp4','.vtt':'text/vtt'};
const localFailures=[];
const server=createServer((req,res)=>{try{const file=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+'/')&&file!==root)throw Error();const path=statSync(file).isDirectory()?join(file,'index.html'):file;res.writeHead(200,{'content-type':types[extname(path)]??'application/octet-stream'});res.end(readFileSync(path));}catch{if(req.url!=='/favicon.ico')localFailures.push(req.url);res.writeHead(404);res.end();}});
let page;
const ok=name=>report.checks.push({name,status:'PASS'});
const contrast=(a,b)=>{const lum=s=>s.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((t,v,i)=>t+v*[.2126,.7152,.0722][i],0);const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
const auditPage=async(label)=>{
  const refs=await page.js(`[...document.querySelectorAll('a[href],img[src],script[src],link[href],video[poster],source[src],track[src]')].flatMap(n=>['href','src','poster'].filter(a=>n.hasAttribute(a)).map(a=>new URL(n.getAttribute(a),location.href).href))`);
  for(const ref of refs){const u=new URL(ref);if(u.origin!==new URL(await page.js('location.href')).origin)continue;let p=resolve(root,'.'+decodeURIComponent(u.pathname));if(statSync(p).isDirectory())p=join(p,'index.html');assert(existsSync(p),`${label}: missing ${u.pathname}`);}
  ok(label+'_local_links_and_media_exist');
};
try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
  page=await launch({width:1440,height:1000});report.browser=await page.js('navigator.userAgent');report.platform=process.platform;
  const shot=async name=>{const path=join(out,`site-${values.stage}-${name}.png`);await page.screenshot(path);report.screenshots.push(path);};
  if(values.live){await page.goto('https://forifor.github.io/oathra/');report.liveHeading=await page.text('h1');await shot('published-ja');}
  for(const [lang,path]of [['ja','/'],['en','/en/']]){
    await page.viewport(1440,1000);await page.goto(origin+path);await page.until("!!document.querySelector('h1')",{label:'home heading'});if(values.stage!=='before')await page.until("document.querySelector('[data-evidence-story]')?.dataset.ready==='true'",{label:'saved record ready'});await shot(lang+'-desktop');
    report[lang]={heading:await page.text('h1')};
    if(values.stage!=='before'){
      await auditPage(lang+'_home');
      report[lang].initialResources=await page.js("performance.getEntriesByType('resource').map(e=>({path:new URL(e.name).pathname,bytes:e.encodedBodySize,durationMs:Math.round(e.duration)}))");
      report[lang].contrast=await page.js(`['.hero h1','.hero-detail','.hero-copy>.micro','.story-tag','.story-source','.story-verdict code','.button','.text-link'].map(selector=>{const n=document.querySelector(selector),c=getComputedStyle(n);let b=n;while(b&&getComputedStyle(b).backgroundColor==='rgba(0, 0, 0, 0)')b=b.parentElement;return {selector,color:c.color,background:b?getComputedStyle(b).backgroundColor:'rgb(255, 255, 255)',fontSize:c.fontSize};})`);
      for(const item of report[lang].contrast){item.ratio=Number(contrast(item.color,item.background).toFixed(2));assert(item.ratio>=4.5,`${lang} text contrast ${item.selector}: ${item.ratio}`);}ok(lang+'_main_text_contrast_4_5');
    }assert(await page.noSidewaysScroll());ok(lang+'_desktop_no_overflow');
    if(values.stage!=='before'){await page.viewport(720,1000);assert(await page.noSidewaysScroll());ok(lang+'_720_reflow');}
    await page.viewport(390,844);assert(await page.noSidewaysScroll());await shot(lang+'-mobile');ok(lang+'_mobile_no_overflow');
    if(values.stage!=='before'){
      await page.viewport(360,800);assert(await page.noSidewaysScroll());ok(lang+'_360_no_overflow');
      await page.emulateReducedMotion();
      await page.until("document.querySelector('[data-evidence-story]')?.dataset.ready==='true'",{label:'saved evidence story'});
      await page.js("document.querySelector('[data-story-step=\"1\"]').scrollIntoView({block:'center'})");await page.tap('[data-story-step="1"]');await page.until("document.querySelector('[data-evidence-story]').dataset.step==='1'",{label:'saved record second step'});
      assert(await page.js("!document.querySelector('[data-evidence-story]').dataset.complete || document.querySelector('[data-evidence-story]').dataset.complete==='false'"));ok(lang+'_recorded_offer_is_incomplete');
      await page.tap('[data-story-step="2"]');await page.until("document.querySelector('[data-evidence-story]').dataset.step==='2'",{label:'saved record confirmed step'});
      assert.equal(await page.js("document.querySelector('[data-evidence-story]').dataset.complete"),'true');ok(lang+'_recorded_confirmation_complete');await shot(lang+'-story-complete-mobile');
      await page.js("document.querySelector('[data-story-step=\"0\"]').focus()");await page.press('Enter');assert.equal(await page.js("document.querySelector('[data-evidence-story]').dataset.step"),'0');ok(lang+'_story_keyboard_operable');
      assert(await page.js("matchMedia('(prefers-reduced-motion: reduce)').matches && getComputedStyle(document.querySelector('.button')).transitionDuration==='0s'"));ok(lang+'_reduced_motion');
      await page.viewport(1440,1000);await page.js("document.querySelector('[data-story-step=\"2\"]').scrollIntoView({block:'center'})");await page.tap('[data-story-step="2"]');await page.js('scrollTo(0,0)');await shot(lang+'-story-complete-desktop');
    }
    if(values.stage!=='before'){await page.viewport(1440,1000);await page.js("document.querySelector('#availability').scrollIntoView({block:'start'})");await shot(lang+'-availability');assert(await page.js("document.querySelector('video').preload==='none' && !document.querySelector('video').autoplay"));ok(lang+'_no_autoplay');}
    await page.viewport(1440,1000);await page.goto(origin+path+'check.html');if(values.stage!=='before')await auditPage(lang+'_checker');await shot(lang+'-check-empty');
    await page.tap('#load-recording');await page.until("document.querySelector('#check-input').value.length>0",{label:'saved negotiation loaded'});
    await page.js("document.querySelector('#check-form button[type=submit]').scrollIntoView({block:'center'})");await page.tap('#check-form button[type=submit]');
    await page.until("!document.querySelector('#download-result').disabled",{label:'actual evidence result'});
    assert.equal(await page.js("JSON.parse(document.querySelector('#raw-result').textContent).complete"),true);ok(lang+'_saved_record_checks_complete');
    await page.js('scrollTo(0,0)');await shot(lang+'-check-result');
    await page.viewport(390,844);assert(await page.noSidewaysScroll());ok(lang+'_check_mobile_no_overflow');if(values.stage!=='before'){await page.js("document.querySelector('.result-panel').scrollIntoView({block:'start'})");await shot(lang+'-check-result-mobile');assert(await page.js("document.querySelectorAll('.field-proof').length > 0"));ok(lang+'_current_values_show_evidence');}
    await page.js("document.querySelector('#clear-input').scrollIntoView({block:'center'})");await page.tap('#clear-input');assert(await page.js("document.querySelector('#download-result').disabled && !document.querySelector('#raw-result').textContent"));ok(lang+'_clear_invalidates_result');
    if(values.stage!=='before'){
      // A real existing raw call record has a different schema from checker input.
      // This exercises validation without inventing a malformed customer transcript.
      await page.js("document.querySelector('#check-input').focus()");await page.type(readFileSync('site/data/call-gpt4o-mini.json','utf8'));
      await page.js("document.querySelector('#check-form button[type=submit]').scrollIntoView({block:'center'})");await page.tap('#check-form button[type=submit]');
      assert(await page.js("document.querySelector('#check-error').textContent.length>0 && document.querySelector('#download-result').disabled"));ok(lang+'_real_raw_record_schema_rejected');await shot(lang+'-check-schema-error');
      await page.js("document.querySelector('#load-recording').scrollIntoView({block:'center'})");await page.tap('#load-recording');await page.until("document.querySelector('#check-input').value.includes('referenceDate')",{label:'restore supported recording'});
      await page.js("document.querySelector('#check-form button[type=submit]').scrollIntoView({block:'center'})");await page.tap('#check-form button[type=submit]');await page.until("!document.querySelector('#download-result').disabled",{label:'validation recovery'});ok(lang+'_validation_recovery');
      await page.goto(origin+path+'#real');await page.until("location.pathname.endsWith('/lab.html') && !!document.querySelector('#player') && document.querySelector('#p-seek').max !== '100'",{label:'legacy replay reachable'});ok(lang+'_legacy_replay_link');await auditPage(lang+'_lab');
      await page.js("document.querySelector('#p-seek').focus()");await page.press('End');
      // Native range keyboard completion is covered by the independent reviewer; loaded data is checked here.
      assert(await page.js("Number(document.querySelector('#p-seek').max)>80000 && !!document.querySelector('#evidence-form') && document.querySelector('#s-tx').children.length>0"));ok(lang+'_existing_lab_and_saved_replay_loaded');
      await page.viewport(390,844);assert(await page.noSidewaysScroll());await shot(lang+'-lab-replay-mobile');ok(lang+'_lab_mobile_no_overflow');
      await page.goto(origin+path+'#sim');await page.until("location.pathname.endsWith('/lab.html') && !!document.querySelector('#evidence-form')",{label:'legacy lab reachable'});ok(lang+'_legacy_lab_link');
    }
  }
  report.localNetworkFailures=localFailures;assert.equal(localFailures.length,0);ok('no_failed_local_assets');
  report.consoleErrors=page.pageErrors.filter(e=>e.startsWith('console.error:')).length;assert.equal(report.consoleErrors,0);ok('no_console_errors');
  report.runtimeExceptions=page.pageErrors.filter(e=>!e.startsWith('console.error:')).length;assert.equal(report.runtimeExceptions,0);ok('no_browser_runtime_exceptions');
  report.sourceHashes=Object.fromEntries(['site/index.html','site/en/index.html','site/check.html','site/en/check.html','site/check.css', ...(values.stage!=='before'?['site/craft.css','site/src/story.ts','site/src/check.ts','site/lab.html','site/en/lab.html','site/legacy.js','site/mark.png','site/check.js','site/story.js','site/lab.css','scripts/build-site.mjs','scripts/ui/site-craft.mjs']:[])].map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));report.status='PASS';
}catch(e){report.status='FAIL';report.error=e.message;process.exitCode=1;}
finally{if(page)await page.close();await new Promise(r=>server.close(r));writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,error:report.error,evidence:output}));}
