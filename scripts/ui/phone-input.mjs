// Uses a configured local caller number only as input. Never starts a call or sends a channel message.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { startArena } from '../../apps/arena/dist/index.js';
import { ScriptedAgent } from '../../providers/simulator/dist/index.js';
import { normalizePhoneNumber } from '../../packages/contract/dist/index.js';
import { launch, sleep } from './cdp.mjs';
if (existsSync('.env')) process.loadEnvFile('.env');
const number = process.env.PHONE_INPUT_TEST_NUMBER || process.env.TWILIO_PHONE_NUMBER;
if (!number) { console.error('BLOCKED: provide PHONE_INPUT_TEST_NUMBER locally; no call will be made.'); process.exit(2); }
const work=mkdtempSync(join(tmpdir(),'oathra-phone-input-'));
const out=resolve('artifacts/quality/phone-input');mkdirSync(out,{recursive:true});
const arena=await startArena({scenariosDir:resolve('scenarios'),brains:{scripted:()=>new ScriptedAgent()},callsDir:join(work,'calls'),port:0});
let page;
try {
 page=await launch({width:1280,height:800});await page.emulateReducedMotion();await page.goto(arena.url+'/?lang=ja');
 await page.click('[data-transport="real"]');
 assert.ok(await page.visible('#phone-number'));
 await page.js("document.querySelector('#phone-number').focus()");await page.type(number);
 await page.press('Tab');await page.type('設定済みの発信元');
 await page.js("document.querySelector('#phone-instruction').focus()");await page.type('この番号への発信準備を確認する。電話はかけない。');
 await page.click('#phone-form button[type=submit]');await page.until("!document.querySelector('#phone-review').hidden");
 assert.equal(await page.js("document.querySelector('#phone-review-fields dd').textContent"),normalizePhoneNumber(number));
 const draft=await page.js("fetch(document.querySelector('#phone-download').href).then(r=>r.json())");
 assert.equal(draft.phone,normalizePhoneNumber(number));assert.equal(draft.kind,'oathra.phone-request');
 const file=join(work,'request.json');writeFileSync(file,JSON.stringify(draft),{mode:0o600});
 const dry=spawnSync(process.execPath,[resolve('packages/cli/dist/bin.js'),'call','--request-file',file,'--dry-run'],{encoding:'utf8'});
 assert.equal(dry.status,0);assert.equal(JSON.parse(dry.stdout).dialed,false);assert.equal(JSON.parse(dry.stdout).contract.goal,'phone.message');assert.equal(JSON.parse(dry.stdout).contract.input.request,draft.instruction);assert.equal(JSON.parse(dry.stdout).contract.target.phone,draft.phone);
 const unapproved=spawnSync(process.execPath,[resolve('packages/cli/dist/bin.js'),'call','--request-file',file],{encoding:'utf8'});
 assert.equal(unapproved.status,1);assert.match(unapproved.stderr,/approve-request/);
 assert.equal((await (await fetch(arena.url+'/api/calls')).json()).length,0,'preparing a phone request creates no call');
 // Actual entered data survives reload, but a reviewed stale draft must not survive an edit.
 await page.goto(arena.url+'/?lang=ja');await page.click('[data-transport="real"]');
 assert.equal(await page.js("document.querySelector('#phone-number').value"),number);
 await page.click('#phone-form button[type=submit]');await page.until("!document.querySelector('#phone-review').hidden");
 await page.js("document.querySelector('#phone-instruction').focus()");await page.type(' 内容を変更。');
 assert.ok(!await page.visible('#phone-review'));
 await page.click('#phone-form button[type=submit]');await page.until("!document.querySelector('#phone-review').hidden");
 for(const [name,width,height] of [['desktop',1280,800],['mobile',390,844]]) {
  await page.viewport(width,height);assert.ok(await page.noSidewaysScroll());
  // Mask only the real configured number in evidence screenshots; assertions above used the actual input.
  await page.js("document.querySelector('#phone-number').style.webkitTextSecurity='disc';document.querySelector('#phone-review-fields dd').textContent='[電話番号は証拠画像で非表示]';document.querySelector('#phone-review').scrollIntoView({block:'center'})");
  await sleep(500);
  await page.screenshot(join(out,'phone-'+name+'.png'));
 }
 await page.click('#phone-clear');assert.equal(await page.js("document.querySelector('#phone-number').value"),'');assert.ok(!await page.visible('#phone-review'));
 const invalid=await fetch(arena.url+'/api/phone/prepare',{method:'POST',body:JSON.stringify({phone:'内線',name:'',instruction:''})});assert.equal(invalid.status,400);
 assert.deepEqual(page.pageErrors,[]);
 console.log('PASS: real local phone input, review, no dialing, inert JSON download, CLI dry-run/no-approval refusal, edit invalidation, reload, clear, 390px/1280px. Screenshots mask configured phone number.');
} finally {if(page)await page.close();arena.server.closeAllConnections();await arena.close();rmSync(work,{recursive:true,force:true});}
