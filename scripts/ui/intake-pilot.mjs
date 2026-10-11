// Real Chromium + Gateway + temporary SQLite. Deliberate failures below are
// local test fixtures. No carrier, model, external network, or user data.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { configuration, createGateway } from '../../apps/gateway/server.mjs';
import { hash } from '../../apps/gateway/lib/security.mjs';
import { INTAKE_KIND } from '../../apps/gateway/lib/intake-pilot.mjs';
import { launch, checklist, sleep } from './cdp.mjs';

const dir = mkdtempSync(join(tmpdir(), 'oathra-intake-ui-')), out = resolve('artifacts/ui/intake-pilot');
mkdirSync(out, { recursive: true });
const token = randomBytes(32).toString('hex'), user = { id: 'demo-operator', team: 'local', role: 'admin', tokenHash: hash(token) };
const config = configuration({ OATHRA_USERS_JSON: JSON.stringify([user]), OATHRA_DATA_KEY: randomBytes(32).toString('hex'), OATHRA_DB: join(dir, 'db.sqlite'), OATHRA_LOCAL_OPEN: 'true' });
const app = await createGateway(config, { env: {} }); await new Promise(r => app.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${app.server.address().port}`; config.publicUrl = base;
const c = checklist('intake pilot'), saved = fixture => app.store.all(INTAKE_KIND, user.id).find(x => x.fixtureId === fixture);
const set = (id, value) => page.js(`document.querySelector(${JSON.stringify('#' + id)}).value=${JSON.stringify(value)}`);
const ready = () => page.until("!document.querySelector('#refresh').disabled && !document.querySelector('#workspace').hidden");
let page;
try {
  page = await launch({ width: 1280, height: 800 }); await page.goto(base + '/intake-pilot'); await ready();
  c.ok(/まだ相談はありません/.test(await page.text('#case-list')), 'empty state has no invented customer cases');
  c.ok(/合成データ専用/.test(await page.text('header')) && /電話発信は行いません/.test(await page.text('.pilot-notice')), 'synthetic mode and no phone connection are visible');
  await page.screenshot(join(out, 'empty-1280.png'));
  await page.click('#add'); await ready();
  c.ok(saved('complete')?.status === 'unhandled' && saved('complete')?.reviewState === 'needs_review', 'import starts unhandled and unreviewed in real SQLite');
  await page.click('#add'); await ready(); c.ok(app.store.all(INTAKE_KIND, user.id).length === 1, 'repeated import does not duplicate work');
  c.ok(await page.js("document.querySelector('#queue').disabled"), 'queue cannot be entered before review and assignment');
  await page.screenshot(join(out, 'review-1280.png'));
  // Evaluate a distinct stacked composition without changing the selected
  // workflow or data. This is a design comparison, never production state.
  await page.js("document.querySelector('#workspace').classList.add('stacked')"); await page.screenshot(join(out, 'alternate-stacked-1280.png'));
  await page.js("document.querySelector('#workspace').classList.remove('stacked')");
  await page.click('#confirm'); await ready(); c.ok(saved('complete').reviewState === 'confirmed' && saved('complete').status === 'unhandled', 'human review does not complete the work');
  const future = new Date(Date.now() + 7200_000); future.setSeconds(0, 0);
  const localFuture = new Date(future.getTime() - future.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  await set('assignee', 'demo_a'); await set('due', localFuture);
  app.store.db.exec("CREATE TEMP TRIGGER fail_intake BEFORE INSERT ON records WHEN NEW.kind='intake-pilot' BEGIN SELECT RAISE(ABORT,'synthetic UI storage failure'); END");
  await page.click('#assign'); await ready();
  c.ok(/保存できません/.test(await page.text('#feedback')) && saved('complete').assignee === null, 'write failure is visible and no saved assignment is claimed');
  c.ok(await page.js("document.querySelector('#assignee').value==='demo_a' && document.querySelector('#due').value!==''"), 'failed save preserves unsaved form values');
  await page.screenshot(join(out, 'save-error-1280.png'));
  app.store.db.exec('DROP TRIGGER fail_intake'); await page.click('#refresh'); await ready();
  await set('assignee', 'demo_a'); await set('due', localFuture); await page.click('#assign'); await ready();
  c.ok(saved('complete').assignee === 'demo_a' && saved('complete').dueAt === future.getTime(), 'owner and precise local-time deadline persist');
  await page.click('#queue'); await ready(); c.ok(saved('complete').status === 'callback_pending', 'explicit queue action is stored');
  await page.goto(base + '/intake-pilot#' + saved('complete').id); await ready();
  c.ok(/折り返し待ち/.test(await page.text('#case-detail')) && await page.js("document.querySelector('#assignee').value==='demo_a'"), 'reload restores selected case, owner and pending state');
  await page.click('#done'); await sleep(100); c.ok(saved('complete').status === 'callback_pending', 'empty completion outcome cannot mark work done');
  await page.screenshot(join(out, 'callback-pending-1280.png'));
  // Simulate a response lost AFTER the durable mutation. The UI must say
  // unknown, stop new writes, then reconcile by GET without repeating it.
  await page.js("window.originalFetch=window.fetch;window.fetch=async(...args)=>{const r=await window.originalFetch(...args);if(args[1]?.method==='POST'){window.fetch=window.originalFetch;throw new TypeError('synthetic lost response');}return r;}");
  await set('outcome', 'handed_over'); await page.click('#done'); await ready();
  c.ok(saved('complete').status === 'done' && /保存できたか確認できません/.test(await page.text('#feedback')), 'lost response never claims success and server records only once');
  c.ok(await page.js("document.querySelector('#done').disabled"), 'unknown result blocks further changes until refresh');
  await page.click('#refresh'); await ready();
  c.ok(/実電話の証明なし/.test(await page.text('#case-detail')) && saved('complete').history.filter(h => h.action === 'done').length === 1, 'refresh reconciles one manual demo result with honest provenance');
  await page.screenshot(join(out, 'recorded-1280.png'));
  await page.click('#reopen'); await ready(); c.ok(saved('complete').status === 'unhandled' && saved('complete').reviewState === 'needs_review', 'reopen requires a fresh human review');
  for (const fixture of ['missing', 'unknown']) {
    await set('fixture', fixture); await page.click('#add'); await ready();
    c.ok(await page.js("document.querySelector('#confirm').disabled") && saved(fixture).reviewState === 'needs_review', `${fixture} cannot be confirmed by an AI claim or an unknown speaker`);
  }
  await page.screenshot(join(out, 'unknown-speaker-1280.png'));
  config.users[0].role = 'viewer'; await page.click('#refresh'); await ready();
  c.ok(await page.js("!document.querySelector('[data-case=complete]').disabled && document.querySelector('#confirm').disabled"), 'viewer can navigate while mutations remain disabled');
  await page.click('[data-case=complete]'); await sleep(100);
  c.ok(/洗面台交換の見積相談/.test(await page.text('#case-detail')), 'viewer can open another case in the same state');
  config.users[0].role = 'admin'; await page.click('#refresh'); await ready(); await page.click('[data-case=unknown]'); await sleep(100);
  await page.viewport(390, 844); await page.screenshot(join(out, 'queue-390.png'));
  await page.js("document.querySelector('#case-detail').scrollIntoView()"); await page.screenshot(join(out, 'unknown-speaker-390.png'));
  c.ok(await page.noSidewaysScroll(), '390px layout has no sideways overflow');
  c.ok((await page.smallTargets()).length === 0, 'visible form controls meet the 44px target');
  await page.viewport(1280, 800); await page.emulateReducedMotion();
  await page.js("document.querySelector('#refresh').focus()"); await page.press('Tab');
  c.ok((await page.focused())?.outline === true, 'keyboard focus is visible');
  await page.js("document.documentElement.style.zoom='2'"); c.ok(await page.noSidewaysScroll(), '200% CSS zoom does not cause sideways overflow (not native browser zoom)');
  await page.screenshot(join(out, 'css-zoom-200.png'));
  await page.js("document.documentElement.style.zoom=''");
  // A stale UI revision must not overwrite another saved action.
  const current = saved('unknown'); app.store.put(INTAKE_KIND, { ...current, revision: current.revision + 1 });
  await set('assignee', 'demo_b'); await set('due', localFuture); await page.click('#assign'); await ready();
  c.ok(/ほかの画面で内容が変わりました/.test(await page.text('#feedback')) && saved('unknown').assignee === null, 'stale revision is explained and cannot overwrite');
  await page.click('#refresh'); await ready();
  // Hold a response after its DB commit, then navigate back to a hashless view.
  await page.goto(base + '/intake-pilot'); await ready();
  const initialTitle = await page.text('.detail-head h2');
  await page.click('[data-case=complete]'); await sleep(100);
  await set('assignee', 'demo_a'); await set('due', localFuture);
  await page.js("window.originalFetch=window.fetch;window.fetch=async(...args)=>{const r=await window.originalFetch(...args);if(args[1]?.method==='POST'){window.fetch=window.originalFetch;await new Promise(resolve=>{window.releasePilotResponse=resolve;});}return r;}");
  await page.click('#assign'); await page.until("typeof window.releasePilotResponse==='function'");
  await page.js('history.back()'); await page.until("location.hash===''");
  await page.js('window.releasePilotResponse()'); await ready();
  c.ok(await page.text('.detail-head h2') === initialTitle && await page.js("location.hash===''") && /洗面台交換の見積相談/.test(await page.text('#feedback')), 'delayed save preserves hashless Back selection and identifies the saved case');
  // Browser navigation retains the selected case and never performs a mutation.
  await page.js(`location.hash=${JSON.stringify(saved('complete').id)}`); await sleep(100); const before = saved('complete').revision;
  await page.js(`location.hash=${JSON.stringify(saved('unknown').id)}`); await sleep(100); await page.js('history.back()'); await sleep(300);
  c.ok(/洗面台交換の見積相談/.test(await page.text('#case-detail')) && saved('complete').revision === before, 'Back returns to the case without replaying actions');
  config.localOpen = false; await page.click('#refresh'); await page.until("document.querySelector('#unavailable').hidden===false");
  c.ok(await page.js("document.querySelector('#workspace').hidden && document.querySelector('#case-detail').textContent===''") && /ログイン/.test(await page.text('#feedback')), 'expired authentication clears the case contents');
  c.ok(page.pageErrors.length === 0, 'no JavaScript exceptions', page.pageErrors.join(' | '));
  c.ok(app.store.list('mission').length === 0 && app.store.list('contact').length === 0 && app.store.list('job').length === 0, 'UI flow created no mission, contact, or outbound job');
  writeFileSync(join(out, 'capture-context.json'), JSON.stringify({ at: new Date().toISOString(), environment: 'cloud Linux / headless Chromium / real temporary SQLite and Gateway', url: '/intake-pilot (loopback)', viewport: { desktop: [1280, 800], mobile: [390, 844] }, data: 'fixed synthetic fixtures only', livePhone: 'not connected', nativeIOS: 'unverified', webkit: 'unverified' }, null, 2));
} finally { await page?.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); c.finish(); }
