import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {startArena} from '../../apps/arena/dist/index.js';
import {ScriptedAgent} from '../../providers/simulator/dist/index.js';
import {launch,sleep} from './cdp.mjs';
const dir=mkdtempSync(join(tmpdir(),'oathra-navigation-'));const out=resolve('artifacts/quality/scenario-navigation');mkdirSync(out,{recursive:true});
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
 if(mode==='play') await page.until("!document.querySelector('#play-form').hidden");
 const calls=await(await fetch(arena.url+'/api/calls')).json();assert.equal(calls.length,mode==='play'?1:2);
 await page.screenshot(join(out,mode+'.png'));
 await page.click('[data-transport="real"]');assert.equal(await page.js("document.querySelector('#phone-instruction').value"),'未送信の依頼を保持する動作確認');
 assert.deepEqual(page.pageErrors,[]);
 const active=calls.find(c=>c.status==='running'); if(active) await fetch(arena.url+'/api/calls/'+active.id+'/hangup',{method:'POST'});
 await page.close();page=null;
}
console.log('PASS: phone route → friend-hype in play/watch; simulator selected; transcript and play input shown; phone draft preserved; actual local runtime, no carrier.');
}finally{for(const c of await(await fetch(arena.url+'/api/calls')).json()) if(c.status==='running') await fetch(arena.url+'/api/calls/'+c.id+'/hangup',{method:'POST'});if(page)await page.close();arena.server.closeAllConnections();await arena.close();rmSync(dir,{recursive:true,force:true});}
