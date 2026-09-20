// Real local persistence and browser checks. No carrier or messaging requests.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startArena } from '../../apps/arena/dist/index.js';
import { launch, sleep } from './cdp.mjs';
const work=mkdtempSync(join(tmpdir(),'oathra-contacts-'));
const out=resolve('artifacts/quality/general-contacts');mkdirSync(out,{recursive:true});
const options={scenariosDir:resolve('scenarios'),brains:{},callsDir:join(work,'calls'),contactsDir:join(work,'contacts'),port:0};
let arena=await startArena(options),page;
try {
 page=await launch({width:1280,height:800});await page.goto(arena.url+'/?lang=ja&contacts=1');
 await page.until("!document.querySelector('#screen-contacts').hidden");
 assert.ok(!await page.visible("#screen-start"),"simulator does not compete with contacts");
 await page.js("document.querySelector('#contact-company').focus()");await page.type('Oathra');
 await page.js("document.querySelector('#contact-lastCallNotes').focus()");await page.type('電話は実施していません。連絡先登録の保存確認。');
 await page.click('#contact-form button[type=submit]');await page.until("document.querySelector('#contact-save-status').textContent.includes('保存しました')");
 let contacts=await (await fetch(arena.url+'/api/contacts')).json();assert.equal(contacts.length,1);const id=contacts[0].id;
 assert.equal(contacts[0].phone,'');assert.equal(contacts[0].company,'Oathra');assert.ok(await page.js("document.querySelector('#contact-use').disabled"));
 await page.goto(arena.url+'/?lang=ja&contacts=1');await page.until("document.querySelector('.contact-item')");await page.click('.contact-item');
 await page.until("document.querySelector('#contact-company').value==='Oathra'");
 assert.equal(await page.js("document.querySelector('#contact-lastCallNotes').value"),'電話は実施していません。連絡先登録の保存確認。');
 await page.js("document.querySelector('#contact-name').focus()");await page.type('連絡先登録の動作確認');
 await page.press('Tab');assert.equal(await page.js('document.activeElement.id'),'contact-company');
 await page.click('#contact-form button[type=submit]');await page.until("document.querySelector('#contact-save-status').textContent.includes('保存しました')");
 for(const [name,width,height] of [['desktop',1280,800],['mobile',390,844],['zoom-layout',640,400]]) {
  await page.viewport(width,height);await sleep(150);assert.ok(await page.noSidewaysScroll(),name);
  await page.js("document.querySelector('#screen-contacts').scrollIntoView({block:'start'})");await sleep(200);await page.screenshot(join(out,'contacts-'+name+'.png'));
 }
 await page.viewport(390,844);
 await page.click('#contacts-back');assert.ok(await page.visible('#contacts-search'));assert.ok(!await page.visible('#contact-name'));
 await page.click('.contact-item');await page.until("document.querySelector('#screen-contacts').classList.contains('editing-contact')");
 await page.js("document.querySelector('#contact-name').focus()");await page.type(' 操作確認');
 const unsaved=await page.js("document.querySelector('#contact-name').value");
 await page.click('#contacts-back');await page.click('#contacts-resume');assert.equal(await page.js("document.querySelector('#contact-name').value"),unsaved);
 assert.ok(await page.js("(()=>{const r=document.querySelector('#contact-form button[type=submit]').getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight})()"),'save stays visible on mobile');
 await page.emulateReducedMotion();
 assert.ok(await page.js("(()=>{const r=document.querySelector('#contact-form button[type=submit]').getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight})()"),'save stays visible with reduced motion');
 assert.equal((await (await fetch(arena.url+'/api/calls')).json()).length,0);
 arena.server.closeAllConnections();await arena.close();arena=await startArena(options);
 const saved=await (await fetch(arena.url+'/api/contacts/'+id)).json();assert.equal(saved.contact.name,'連絡先登録の動作確認');assert.equal(saved.contact.revision,2);assert.deepEqual(saved.history,[]);
 assert.deepEqual(page.pageErrors,[]);
 console.log('PASS: company-only registration without phone, durable save/edit/server restart, notes, disabled phone action, keyboard Tab, 1280/390/640 widths, reduced motion, zero calls. 640px is layout stress, not native browser zoom/IME validation.');
}finally{if(page)await page.close();arena.server.closeAllConnections();await arena.close();rmSync(work,{recursive:true,force:true});}
