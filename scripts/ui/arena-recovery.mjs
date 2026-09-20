// Product simulator and real browser/server. No substituted fetch responses or invented recordings.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startArena } from '../../apps/arena/dist/index.js';
import { ScriptedAgent } from '../../providers/simulator/dist/index.js';
import { launch } from './cdp.mjs';
const work = mkdtempSync(join(tmpdir(), 'oathra-recovery-'));
const out = resolve(process.env.QUALITY_OUT_DIR || 'artifacts/quality'); mkdirSync(out, { recursive: true });
const arena = await startArena({ scenariosDir: resolve('scenarios'), brains: { scripted: () => new ScriptedAgent() }, callsDir: join(work, 'calls'), port: 0 });
let page;
try {
  page = await launch({ width: 1440, height: 900 });
  await page.emulateReducedMotion();
  await page.goto(arena.url + '/?lang=ja&practice=1');
  await page.until("document.querySelectorAll('.scenario-btn').length > 0");
  assert.match(await page.text('.practice-note'), /外部送信なし/);
  assert.ok(!await page.visible('#brain-row'));
  // Navigate exclusively with real Tab/Enter to the editable human-answer mode.
  let reached = false;
  for (let i = 0; i < 24; i++) {
    await page.press('Tab');
    if (await page.js("document.activeElement?.dataset.mode==='play'")) { reached = true; break; }
  }
  assert.ok(reached, 'play is keyboard reachable'); await page.press('Enter');
  reached = false;
  for (let i = 0; i < 20; i++) {
    await page.press('Tab');
    if (await page.js("document.activeElement?.classList.contains('scenario-btn')")) { reached = true; break; }
  }
  assert.ok(reached); assert.ok((await page.focused()).outline, 'scenario focus visible');
  await page.press('Enter');
  await page.until("!document.querySelector('#play-form').hidden");
  const callUrl = await page.js('location.href'), id = new URL(callUrl).searchParams.get('call');
  assert.ok(id);
  // A rapid second start must resume the same call, not create another operation.
  const selected = await page.js("document.querySelector('.scenario-btn.is-current')?.dataset.scenario");
  await new Promise(r => setTimeout(r, 120));
  await page.click(`.scenario-btn[data-scenario="${selected}"]`);
  await page.until("!document.querySelector('.scenario-btn').disabled");
  assert.equal((await (await fetch(arena.url + '/api/calls')).json()).length, 1, 'rapid repeat creates no second call');
  await page.click('#call-back');
  assert.ok(await page.visible('#resume-call'), 'leaving keeps a visible resume action');
  await page.click('.scenario-btn[data-scenario="restaurant-reservation"]');
  await page.until("!document.querySelector('#screen-call').hidden && !document.querySelector('.scenario-btn').disabled");
  assert.equal(new URL(await page.js('location.href')).searchParams.get('call'), id, 'another scenario cannot orphan the active call');
  assert.equal((await (await fetch(arena.url + '/api/calls')).json()).length, 1);
  await page.goto(arena.url + '/?lang=ja&practice=1');
  await page.until("!document.querySelector('#screen-call').hidden");
  assert.equal(new URL(await page.js('location.href')).searchParams.get('call'), id, 'same-tab clean URL restores the running call');
  assert.equal(await page.js("document.querySelector('.mode-btn[aria-pressed=true]').dataset.mode"), 'play', 'restored call mode matches mode selection');
  await page.click('#call-back');
  await page.click('#resume-call');
  await page.until("!document.querySelector('#screen-call').hidden");
  await page.screenshot(join(out, 'arena-resumed.png'));

  await page.until("document.activeElement.id==='play-text'");
  await page.type('はい、お電話ありがとうございます。');
  await page.press('Enter');
  await page.until("[...document.querySelectorAll('#transcript .line.callee .say')].some(n=>n.textContent.includes('お電話ありがとうございます'))");
  await page.goto(callUrl);
  await page.until("!document.querySelector('#screen-call').hidden");
  assert.equal((await (await fetch(arena.url + '/api/calls')).json()).length, 1, 'reload does not restart');
  // Real network disconnection and safe same-call recovery.
  await new Promise(resolve => { arena.server.close(resolve); arena.server.closeAllConnections(); });
  await page.until("!document.querySelector('#recovery').hidden", { timeout: 30000 });
  await page.screenshot(join(out, 'arena-disconnected.png'));
  await new Promise(resolve => arena.server.listen(Number(new URL(arena.url).port), '127.0.0.1', resolve));
  await page.click('#recover-call');
  await page.until("document.querySelector('#recovery').hidden");
  assert.equal((await (await fetch(arena.url + '/api/calls')).json()).length, 1);
  await page.click('#play-hangup');
  await page.until("document.querySelector('.save-state')?.textContent.includes('保存済み')");
  assert.match(await page.text('.result-fc'), /未実施/);
  assert.ok(await page.js("[...document.querySelectorAll('.result-actions .btn, .result-more > summary, .starter-example > summary')].every(n=>n.getBoundingClientRect().height>=44)"), 'result and editable-sample actions are at least 44px');
  const artifact = await (await fetch(arena.url + `/api/calls/${id}/artifact`)).json();
  assert.equal(artifact.endReason, 'cancelled');
  assert.ok(!await page.visible('#resume-call'), 'terminal call clears resume action');
  assert.deepEqual(artifact.result, JSON.parse(readFileSync(join(work, 'calls', id, 'result.json'), 'utf8')));
  await page.screenshot(join(out, 'arena-result.png'));
  for (const [name, width, height] of [['mobile',390,844],['reflow-200',720,450],['narrow',320,640]]) {
    await page.viewport(width,height);
    assert.ok(await page.noSidewaysScroll(), name);
    assert.ok(await page.visible('.result-actions a[download]'), name + ' artifact reachable');
    await page.js("document.querySelector('#result-wrap').scrollIntoView({block:'start'})");
    await page.screenshot(join(out, `arena-${name}.png`), { fullPage: false });
  }
  await page.goto(arena.url + `/?lang=ja&replay=${id}`);
  await page.until("document.querySelector('.save-state')?.textContent.includes('保存済み')");
  const replayHref = await page.js("document.querySelector('.result-actions a[download]').href");
  assert.deepEqual(await (await fetch(replayHref)).json(), artifact);
  await page.goto(await page.js('location.href'));
  await page.until("document.querySelector('.save-state')?.textContent.includes('保存済み')");
  assert.equal(new URL(await page.js('location.href')).searchParams.get('replay'), id);
  // Long editable input uses existing recorded words; never transmits outside localhost.
  await page.goto(arena.url + '/?lang=ja&mode=play');
  await page.until("document.querySelectorAll('.scenario-btn').length > 0");
  await page.click('.starter-example summary');
  const recording = JSON.parse(readFileSync('site/data/call-gpt4o-mini.json','utf8'));
  const text = recording.events.filter(e=>e.type==='transcript.final').map(e=>e.text).join(' ');
  await page.js("document.querySelector('#starter-text').value=''; document.querySelector('#starter-text').focus()");
  await page.type(text);
  await page.click('#starter-run');
  await page.until("document.activeElement.id==='play-text'");
  assert.equal(await page.js("document.querySelector('#play-text').value"), text);
  assert.ok(await page.noSidewaysScroll());
  await page.click('#play-hangup');
  await page.until("document.querySelector('.save-state')?.textContent.includes('保存済み')");
  // A call cancelled before any speech has an empty final transcript, never "Dialing".
  const early = await (await fetch(arena.url + '/api/calls', { method: 'POST', body: JSON.stringify({scenarioId:'restaurant-reservation',mode:'play'}) })).json();
  await fetch(arena.url + `/api/calls/${early.callId}/hangup`, { method: 'POST' });
  await (await fetch(arena.url + `/api/calls/${early.callId}/events`)).text();
  await page.goto(arena.url + `/?call=${early.callId}&lang=ja&theme=dark`);
  await page.until("document.querySelector('.save-state')?.textContent.includes('保存済み')");
  assert.equal(await page.text('.transcript-empty'), '会話はありません。');
  assert.ok(await page.js("getComputedStyle(document.querySelector('.result-actions a')).color===getComputedStyle(document.querySelector('.result-actions .btn:not(.primary):not(a)')).color"));
  await page.screenshot(join(out, 'arena-empty-result-dark.png'));
  assert.deepEqual(page.pageErrors, []);
  console.log('PASS: keyboard start/edit/send, focus, real offline/resync, reload same call, cancellation, disk/artifact/replay equality, mobile/320/reflow, long editable recording text, reduced motion');
  console.log('BLOCKED: macOS Japanese IME, real-device/native/real-user evaluation not performed. Browser zoom is tested separately by arena-zoom.mjs; 720x450 here is reflow equivalence only.');
} finally { if (page) await page.close(); arena.server.closeAllConnections(); await arena.close(); rmSync(work,{recursive:true,force:true}); }
