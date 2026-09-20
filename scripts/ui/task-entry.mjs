import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {startArena} from '../../apps/arena/dist/index.js';
import {ScriptedAgent} from '../../providers/simulator/dist/index.js';
import {launch,sleep} from './cdp.mjs';
const dir=mkdtempSync(join(tmpdir(),'oathra-entry-')),out=resolve('artifacts/quality/task-entry');mkdirSync(out,{recursive:true});
const arena=await startArena({scenariosDir:resolve('scenarios'),brains:{scripted:()=>new ScriptedAgent()},callsDir:join(dir,'calls'),port:0});let page;
try{
page=await launch({width:1280,height:800});await page.goto(arena.url+'/?lang=ja');
await page.until("document.querySelectorAll('.scenario-btn').length>0");
assert.ok(await page.visible('#screen-home'));assert.ok(!await page.visible('#screen-start'));
assert.ok(await page.visible('#navigation-back'));assert.ok(await page.js("document.querySelector('#navigation-back').disabled"));
await page.click('#home-phone');await page.js("document.querySelector('#phone-instruction').value='戻る操作で入力が残ることを確認';document.querySelector('#phone-instruction').dispatchEvent(new Event('input',{bubbles:true}))");
await page.click('#home-open');await page.click('#navigation-back');assert.ok(await page.visible('#screen-real'));assert.equal(await page.js("document.querySelector('#phone-instruction').value"),'戻る操作で入力が残ることを確認');
await page.click('#phone-clear');await page.click('#navigation-back');assert.ok(await page.visible('#screen-home'));
await page.click('#home-contacts');await page.until("document.querySelector('#screen-contacts').classList.contains('editing-contact')");await page.click('#navigation-back');assert.ok(await page.visible('#screen-contacts'));assert.equal(await page.js("document.querySelector('#screen-contacts').classList.contains('editing-contact')"),false);await page.click('#navigation-back');assert.ok(await page.visible('#screen-home'));
await page.click('#home-practice');await page.js("document.querySelector('#navigation-back').focus()");await page.press('Enter');assert.ok(await page.visible('#screen-home'));
await page.screenshot(join(out,'home-desktop.png'));
// Compare actual content in alternate compositions, not different color schemes.
await page.js("{const s=document.createElement('style');s.id='layout-study';s.textContent='.home-choices{grid-template-columns:repeat(3,1fr)}.home-choice:first-child{grid-row:auto}';document.head.append(s)}");
await page.screenshot(join(out,'study-equal-columns.png'));
await page.js("document.querySelector('#layout-study').textContent='.home-choices{grid-template-columns:1fr}.home-choice:first-child{grid-row:auto}.home-choice{padding:16px}'");
await page.screenshot(join(out,'study-stacked.png'));await page.js("document.querySelector('#layout-study').remove()");
await page.click('#home-phone');assert.ok(await page.visible('#phone-number'));assert.ok(!await page.visible('#screen-start'));
await page.until("document.querySelector('#phone-readiness').textContent.includes('設定が必要')");
assert.match(await page.text('#phone-readiness'),/設定が必要/);
await sleep(500);await page.screenshot(join(out,'phone-desktop.png'));
await page.click('#home-open');await page.click('#home-contacts');assert.ok(await page.visible('#contact-company'));assert.ok(!await page.visible('#screen-start'));
await page.click('#home-open');await page.click('#home-practice');assert.ok(await page.visible('#screen-start'));assert.ok(!await page.visible('#screen-home'));
await page.click('[data-mode=play]');await page.click('[data-scenario=friend-hype]');await page.until("!document.querySelector('#play-form').hidden");
await page.click('#call-back');await page.click('#navigation-back');await page.until("!document.querySelector('#screen-call').hidden");await page.js("document.querySelector('#play-text').focus()");await page.type('戻った画面で会話の更新を確認します。');await page.press('Enter');await page.until("document.querySelector('#transcript').textContent.includes('戻った画面で会話の更新を確認します。')");await page.click('#navigation-back');assert.ok(await page.visible('#screen-start'));await page.click('#home-open');assert.ok(await page.visible('#home-resume'));await page.click('#home-resume');await page.until("!document.querySelector('#screen-call').hidden");
await page.click('#call-hangup');await page.until("document.querySelector('#call-hangup').hidden");
await page.click('#home-open');assert.ok(!await page.visible('#home-resume'));
for(const width of [390,640]){await page.viewport(width,844);assert.ok(await page.noSidewaysScroll());await page.screenshot(join(out,'home-'+width+'.png'));await page.click('#home-phone');assert.ok(!await page.visible('#screen-start'));assert.ok(await page.noSidewaysScroll());await page.click('#home-open');}
assert.deepEqual(page.pageErrors,[]);console.log('PASS: purpose chooser, real-call limitation before input, independent contacts/phone/practice, friend play start/resume/end, desktop/mobile no overflow, no carrier.');
}finally{if(page)await page.close();arena.server.closeAllConnections();await arena.close();rmSync(dir,{recursive:true,force:true});}
