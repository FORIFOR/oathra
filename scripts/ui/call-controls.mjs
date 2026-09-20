import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {startArena} from '../../apps/arena/dist/index.js';
import {ScriptedAgent} from '../../providers/simulator/dist/index.js';
import {launch,sleep} from './cdp.mjs';
const dir=mkdtempSync(join(tmpdir(),'oathra-navigation-'));const out=resolve('artifacts/quality/call-controls');mkdirSync(out,{recursive:true});
const arena=await startArena({scenariosDir:resolve('scenarios'),brains:{scripted:()=>new ScriptedAgent()},callsDir:join(dir,'calls'),port:0});let page;
try{
for(const mode of ['play','watch']){
 page=await launch({width:1280,height:800});await page.goto(arena.url+'/?lang=ja&phone=1');
 await page.until("!document.querySelector('#screen-real').hidden");
 await page.js("document.querySelector('#phone-instruction').focus()");await page.type('未送信の依頼を保持する動作確認');
 await page.click(`[data-mode="${mode}"]`);await page.click('[data-scenario="friend-hype"]');
 await page.until("!document.querySelector('#screen-call').hidden",{timeout:4000,label:'scenario starts directly from phone request'});
 assert.equal(await page.js("document.querySelector('[data-transport=simulator]').getAttribute('aria-pressed')"),'true');
 assert.equal(await page.js("new URL(location.href).searchParams.has('phone')"),false);
 await page.until("document.querySelectorAll('#transcript .line').length > 0");
 if(mode==='play') {
   await page.until("!document.querySelector('#play-form').hidden");
   await page.js("document.querySelector('#play-text').focus()");await page.type('今は話せないので、また後で電話してください。');await page.press('Enter');
   await page.until("document.querySelector('#transcript').textContent.includes('また後で電話してください')");
 }
 await page.viewport(390,844);assert.ok(await page.noSidewaysScroll());
 await page.js("document.querySelector('#call-hangup').scrollIntoView({block:'center'})");
 await page.screenshot(join(out,mode+'-mobile.png'));
 await page.viewport(1280,800);

 const calls=await(await fetch(arena.url+'/api/calls')).json();assert.equal(calls.length,mode==='play'?1:2);
 await page.screenshot(join(out,mode+'.png'));
 await page.click('[data-transport="real"]');assert.equal(await page.js("document.querySelector('#phone-instruction').value"),'未送信の依頼を保持する動作確認');
 assert.deepEqual(page.pageErrors,[]);
 await page.click('[data-transport="simulator"]');
 await page.click('#resume-call');await page.until("!document.querySelector('#screen-call').hidden");
 if(mode==='play') {
   await new Promise(resolve=>{arena.server.close(resolve);arena.server.closeAllConnections();});
   try {
     await page.click('#call-hangup');
     await page.until("document.querySelector('#recovery p').textContent.includes('終了したか確認できません')");
     assert.ok(await page.js("document.querySelector('#call-hangup').disabled"));
   } finally {await new Promise(resolve=>arena.server.listen(Number(new URL(arena.url).port),'127.0.0.1',resolve));}
   await page.click('#recover-call');await page.until("!document.querySelector('#call-hangup').disabled");
 }
 await page.click('#call-hangup');
 await page.until("document.querySelector('#call-hangup').hidden && document.querySelector('#result-wrap').textContent.trim().length>0");
 const id=new URL(await page.js('location.href')).searchParams.get('call');
 const ended=await(await fetch(arena.url+'/api/calls/'+id)).json();
 assert.notEqual(ended.status,'running');assert.equal(ended.endReason,'cancelled');
 assert.equal(await page.text('.result-h'),'通話を中断しました');
 await sleep(1700);await page.screenshot(join(out,mode+'-ended.png'));

 await page.close();page=null;
}
console.log('PASS: friend call play/watch, reply delivered, mobile controls, leave/resume, UI end→server cancelled, no carrier.');
}finally{for(const c of await(await fetch(arena.url+'/api/calls')).json()) if(c.status==='running') await fetch(arena.url+'/api/calls/'+c.id+'/hangup',{method:'POST'});if(page)await page.close();arena.server.closeAllConnections();await arena.close();rmSync(dir,{recursive:true,force:true});}
