// Independent browser checks for the public, synthetic use-case demos.
// Uses a temporary loopback static server unless DEMO_BASE_URL is set.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs node scripts/ui/use-cases.mjs
// Chrome remains sandboxed; this script never calls a transport or a provider.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

let base = process.env.DEMO_BASE_URL;
const out = resolve('artifacts/use-cases');
const filter = process.env.QA_FILTER ? new RegExp(process.env.QA_FILTER) : null;
const reportName = process.env.QA_REPORT_NAME || 'qa-results.json';
if (!/^qa-[a-z0-9-]+\.json$/.test(reportName)) throw new Error('QA_REPORT_NAME must be a qa-*.json filename.');
mkdirSync(out, { recursive: true });
const moduleName = process.env.PLAYWRIGHT_MODULE || 'playwright-core';
const { chromium } = await import(moduleName.startsWith('/') ? pathToFileURL(moduleName).href : moduleName);
const chrome = process.env.CHROME_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
if (!chrome || !existsSync(chrome)) throw new Error('Set CHROME_PATH to the installed Chrome executable.');
const browser = await chromium.launch({ executablePath: chrome, headless: true, chromiumSandbox: true,
  args: ['--disable-background-networking', '--no-first-run', '--no-default-browser-check'] });
let server;
if (!base) {
  const root = resolve('site');
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp4': 'video/mp4' };
  server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      let file = resolve(root, `.${pathname}`);
      if (file !== root && !file.startsWith(`${root}${sep}`)) { res.writeHead(403); res.end(); return; }
      if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
}
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ja-JP', timezoneId: 'UTC' });
const page = await context.newPage();
const results = [], screenshots = [], requests = [], pageErrors = [], consoleErrors = [], httpErrors = [];
page.on('request', r => requests.push({ url: r.url(), method: r.method(), type: r.resourceType() }));
page.on('response', r => { if (r.status() >= 400) httpErrors.push({ url: r.url(), status: r.status() }); });
page.on('pageerror', e => pageErrors.push(e.message));
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
const snapshot = () => page.evaluate(() => window.demoSnapshot());
const control = id => page.getByTestId(id);
const check = (value, message) => assert.ok(value, message);
const pause = () => page.waitForTimeout(390); // The product intentionally debounces next at 350 ms.
async function shot(name, fullPage = false) {
  const file = resolve(out, `qa-${name}.png`);
  await page.screenshot({ path: file, fullPage });
  screenshots.push(file);
}
async function run(name, fn) {
  if (filter && !filter.test(name)) return;
  const began = Date.now();
  try { const details = await fn(); results.push({ name, status: 'PASS', milliseconds: Date.now() - began, details }); console.log(`PASS ${name}`); }
  catch (e) { results.push({ name, status: 'FAIL', milliseconds: Date.now() - began, error: e.stack }); console.error(`FAIL ${name}: ${e.message}`); await shot(`failure-${name.replace(/[^a-z0-9]+/gi, '-')}`).catch(() => {}); }
}
async function open(kind, scenario = 'normal') {
  await page.goto(`${base}/demos/?flow=${kind}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof window.demoSnapshot === 'function');
  if (scenario !== 'normal') await control('scenario').selectOption(scenario);
  const s = await snapshot();
  assert.equal(s.kind, kind); assert.equal(s.stage, 'input'); assert.equal(s.approval, null);
  assert.equal(s.transcript.length, 0); assert.equal(s.result, null);
  check(await control('disclaimer').isVisible(), 'Disclosure visible on input');
  assert.equal((await control('disclaimer').innerText()).trim(), '構想デモ・実際の発信/予約は行いません');
  return s;
}
async function reviewAndApprove() {
  await control('review').click();
  let s = await snapshot();
  assert.equal(s.stage, 'review'); assert.equal(s.approval, null); assert.equal(s.transcript.length, 0);
  // Form values commit on change/submit; compare approval with the terms the
  // person actually reviewed, not the pre-blur state of the previous input.
  const reviewed = s;
  const text = await page.locator('#screen').innerText();
  check(text.includes(s.target.name) && text.includes(s.target.number), 'Review shows exact synthetic target');
  check(text.includes('開示する情報') && text.includes('任せる範囲'), 'Disclosure and scope visible before approval');
  check(text.includes('費用 ¥0') && text.includes('購入義務なし'), 'No charge / purchase permission visible');
  await control('approve').click();
  s = await snapshot();
  assert.equal(s.stage, 'calling'); assert.equal(s.step, 0); assert.equal(s.transcript.length, 0);
  check(s.approval, 'Explicit approval required');
  assert.deepEqual(s.approval.input, reviewed.input); assert.deepEqual(s.approval.target, reviewed.target);
  assert.equal(s.approval.maxCharge, 0); assert.equal(s.approval.purchaseObligation, false);
  return s;
}
async function finish() {
  let s = await snapshot();
  for (let guard = 0; s.stage === 'calling' && guard < 25; guard++) {
    check(s.approval, 'Calling never occurs without approval');
    assert.equal(s.result, null, 'No success before complete evidence evaluation');
    const step = s.step;
    await pause(); await control('next').click(); s = await snapshot();
    assert.equal(s.step, step + 1, 'Each deliberate click consumes exactly one turn');
    check(await control('disclaimer').isVisible(), 'Disclosure persists throughout operation');
  }
  assert.equal(s.stage, 'result'); check(s.result, 'Result is present');
  check(await control('result').isVisible(), 'Result visible');
  return s;
}
async function noOverflow() {
  const geometry = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
  check(geometry.scroll <= geometry.viewport + 1, `Horizontal overflow: ${JSON.stringify(geometry)}`);
  return geometry;
}
async function tabTo(id) {
  for (let i = 0; i < 45; i++) {
    if (await page.evaluate(id => document.activeElement?.getAttribute('data-testid') === id, id)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Keyboard cannot reach ${id}`);
}

try {
  for (const kind of ['restaurant', 'stock', 'modify']) {
    for (const scenario of ['normal', 'unavailable', 'declined', 'over-budget', 'ambiguous', 'correction']) {
      await run(`${kind}-${scenario}`, async () => {
        await open(kind, scenario); await reviewAndApprove(); const s = await finish();
        if (scenario === 'normal') {
          assert.equal(s.result.status, 'completed'); check(s.result.evidence.length > 0, 'Callee evidence is returned');
          if (kind === 'stock') check(s.result.detail.includes('無料') && s.result.detail.includes('購入義務なし'), 'Stock outcome explains free hold');
          if (kind === 'modify') assert.equal(s.reservation.time, '20:00');
        } else {
          check(s.result.status !== 'completed', `${scenario} must not be success`);
          if (scenario === 'unavailable') assert.equal(s.result.status, 'failed');
          if (scenario === 'over-budget') assert.equal(s.result.status, 'constraint_violation');
          if (kind === 'modify') { assert.equal(s.reservation.time, '19:00'); assert.equal(s.result.originalPreserved, true); }
        }
        await noOverflow(); await shot(`${kind}-${scenario}-result`);
        return { status: s.result.status, title: s.result.title, fields: s.result.fields, reservation: s.reservation, turns: s.transcript.length };
      });
    }
  }

  for (const kind of ['restaurant', 'stock', 'modify']) {
    await run(`${kind}-back-cancel-reapprove`, async () => {
      const original = await open(kind); await control('review').click(); await control('back').click();
      let s = await snapshot(); assert.equal(s.stage, 'input'); assert.equal(s.approval, null); assert.deepEqual(s.input, original.input);
      await control('review').click(); await control('cancel').click(); s = await snapshot();
      assert.equal(s.result.status, 'cancelled'); assert.equal(s.approval, null); assert.equal(s.transcript.length, 0);
      await control('back').click(); await reviewAndApprove(); await pause(); await control('next').click();
      await control('back').click(); s = await snapshot();
      assert.equal(s.stage, 'input'); assert.equal(s.approval, null); assert.equal(s.transcript.length, 0);
      if (kind !== 'modify') await control('input-budget').fill('12000');
      else await control('scenario').selectOption('declined');
      await reviewAndApprove(); s = await snapshot();
      if (kind !== 'modify') assert.equal(s.approval.input.budget, 12000);
      else assert.equal(s.scenario, 'declined');
      await pause(); await control('next').click(); await control('cancel').click();
      s = await snapshot(); assert.equal(s.result.status, 'cancelled'); assert.equal(s.approval, null);
      if (kind === 'modify') assert.equal(s.reservation.time, '19:00');
      const after = JSON.stringify(s); await page.waitForTimeout(500); assert.equal(JSON.stringify(await snapshot()), after, 'Cancelled state stays stopped');
      return { cancelledDuringCall: true, reapprovalRequired: true };
    });
    await run(`${kind}-double-click`, async () => {
      await open(kind); await control('review').click();
      await control('approve').dblclick({ delay: 50 });
      let s = await snapshot(); assert.equal(s.stage, 'calling'); check(s.approval, 'One approval remains'); check(s.step <= 1, 'Approval double click cannot skip more than one turn');
      await pause(); const before = s.step; await control('next').dblclick({ delay: 50 });
      s = await snapshot(); assert.equal(s.step, before + 1, 'Double next does not skip turns');
      await control('cancel').click(); s = await snapshot(); assert.equal(s.result.status, 'cancelled');
      return { stepBeforeDouble: before, stepAfterDouble: before + 1 };
    });
    await run(`${kind}-reload-safe`, async () => {
      await open(kind); await reviewAndApprove(); await pause(); await control('next').click();
      await page.reload({ waitUntil: 'networkidle' }); const s = await snapshot();
      assert.equal(s.stage, 'input'); assert.equal(s.approval, null); assert.equal(s.transcript.length, 0); assert.equal(s.result, null);
      if (kind === 'modify') assert.equal(s.reservation.time, '19:00');
      return { behavior: 'Reload clears synthetic progress and approval; never resumes or sends a call.' };
    });
  }
  await run('switch-flow-invalidates-approval', async () => {
    await open('restaurant'); await reviewAndApprove(); await pause(); await control('next').click(); await control('flow-stock').click();
    let s = await snapshot(); assert.equal(s.kind, 'stock'); assert.equal(s.stage, 'input'); assert.equal(s.approval, null); assert.equal(s.transcript.length, 0);
    await control('review').click(); await control('scenario').selectOption('correction');
    s = await snapshot(); assert.equal(s.stage, 'input'); assert.equal(s.approval, null); assert.equal(s.scenario, 'correction');
  });
  await run('snapshot-cannot-mutate-state', async () => {
    await open('restaurant');
    await page.evaluate(() => { const s = window.demoSnapshot(); s.stage = 'calling'; s.input.budget = 999999; s.target.number = '+123456789'; });
    const s = await snapshot(); assert.equal(s.stage, 'input'); assert.equal(s.input.budget, 8000); assert.equal(s.target.number, 'SIM-001');
  });
  for (const kind of ['restaurant', 'stock']) {
    await run(`${kind}-malformed-input`, async () => {
      const invalid = [['budget', ''], ['budget', '0'], ['budget', '-1'], ['budget', '20001'], ['budget', '8000.5'], ['date', '2026-10-10'], ['date', '2027-01-01']];
      if (kind === 'restaurant') invalid.push(['partySize', '0'], ['partySize', '7'], ['partySize', '1.5']);
      for (const [field, value] of invalid) {
        await open(kind); await control(`input-${field}`).fill(value); await control('review').click();
        const s = await snapshot(); assert.equal(s.stage, 'input', `Reject ${field}=${value}`); assert.equal(s.approval, null); assert.equal(s.transcript.length, 0);
      }
      return { invalidInputs: invalid };
    });
  }
  await run('edited-target-and-terms-reach-result', async () => {
    await open('restaurant'); await page.locator('input[value="harbor"]').check(); await control('input-date').fill('2026-12-05');
    await control('input-time').selectOption('20:30'); await control('input-partySize').fill('4'); await control('input-budget').fill('14000');
    await reviewAndApprove(); const s = await finish(); assert.equal(s.result.status, 'completed'); assert.equal(s.approval.target.number, 'SIM-002');
    assert.equal(s.result.fields.date, '2026-12-05'); assert.equal(s.result.fields.time, '20:30'); assert.equal(s.result.fields.partySize, 4);
    return { fields: s.result.fields, target: s.target };
  });
  await run('stock-edited-model-price-deadline', async () => {
    await open('stock'); await control('input-model').selectOption('FZ-2000'); await control('input-date').fill('2026-12-06'); await control('input-pickupDeadline').selectOption('17:30'); await control('input-budget').fill('9900');
    await reviewAndApprove(); const s = await finish(); assert.equal(s.result.status, 'completed'); assert.equal(s.result.fields.serial, 'FZ2000'); assert.equal(s.result.fields.price, 9800); assert.equal(s.result.fields.time, '17:30');
    return { fields: s.result.fields };
  });
  await run('stock-price-below-fixed-product-price', async () => {
    await open('stock'); await control('input-budget').fill('2000'); await reviewAndApprove(); const s = await finish(); assert.equal(s.result.status, 'constraint_violation');
    return { fields: s.result.fields, title: s.result.title };
  });
  for (const kind of ['restaurant', 'stock', 'modify']) {
    await run(`${kind}-keyboard`, async () => {
      await open(kind); await tabTo('review');
      const focus = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return { outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth }; });
      check(focus.outlineStyle !== 'none' && parseFloat(focus.outlineWidth) > 0, 'Keyboard focus indicator visible');
      await page.keyboard.press('Enter'); assert.equal((await snapshot()).stage, 'review');
      await tabTo('approve'); await page.keyboard.press('Enter'); assert.equal((await snapshot()).stage, 'calling');
      await tabTo('next'); await pause(); await page.keyboard.press('Enter'); assert.equal((await snapshot()).step, 1);
      await tabTo('cancel'); await page.keyboard.press('Enter'); assert.equal((await snapshot()).result.status, 'cancelled');
      await shot(`${kind}-keyboard-cancelled`); return { focus };
    });
    await run(`${kind}-keyboard-complete`, async () => {
      await open(kind); await tabTo('review'); await page.keyboard.press('Enter');
      await tabTo('approve'); await page.keyboard.press('Enter'); await tabTo('next');
      let s = await snapshot();
      for (let guard = 0; s.stage === 'calling' && guard < 25; guard++) {
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'next', 'Next retains keyboard focus after re-render');
        check(s.approval, 'Keyboard call remains explicitly approved'); const step = s.step;
        await pause(); await page.keyboard.press('Enter'); s = await snapshot(); assert.equal(s.step, step + 1);
      }
      assert.equal(s.stage, 'result'); assert.equal(s.result.status, 'completed');
      check(await page.evaluate(() => document.activeElement === document.querySelector('#screen h2')), 'Result heading receives focus');
      await shot(`${kind}-keyboard-completed`); return { turns: s.transcript.length, status: s.result.status };
    });
  }
  for (const width of [1440, 1024, 390]) {
    for (const kind of ['restaurant', 'stock', 'modify']) {
      await run(`${kind}-layout-${width}`, async () => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await open(kind); await noOverflow();
        await shot(`${kind}-${width}-input`, true); await control('review').click(); await noOverflow();
        await shot(`${kind}-${width}-review`, true); await control('approve').click(); await noOverflow();
        await shot(`${kind}-${width}-calling`, true); const s = await finish(); await noOverflow();
        assert.equal(s.result.status, 'completed'); await shot(`${kind}-${width}-result`, true);
        await control('result').scrollIntoViewIfNeeded();
        check(await control('disclaimer').isVisible(), 'Sticky disclosure remains in viewport after scroll');
        const notice = await control('disclaimer').boundingBox(); check(notice.y >= 0 && notice.y + notice.height <= (width === 390 ? 844 : 1000), 'Disclosure not outside viewport');
        await shot(`${kind}-${width}-result-viewport`);
        const targets = await page.locator('button:visible,input:visible,select:visible,summary:visible').evaluateAll(ns => ns.map(n => ({ tag:n.tagName, id:n.getAttribute('data-testid'), text:n.textContent?.trim(), height:n.getBoundingClientRect().height })).filter(n => n.height < 44));
        return { width, minimumTargetExceptions: targets };
      });
    }
  }
  await run('reduced-motion-and-200-percent-reflow', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' }); await page.setViewportSize({ width: 720, height: 500 }); await open('restaurant');
    await noOverflow(); await reviewAndApprove(); await noOverflow(); const s = await finish(); assert.equal(s.result.status, 'completed');
    const transition = await control('back').evaluate(el => getComputedStyle(el).transitionDuration); assert.equal(transition, '0s');
    await shot('720-reflow-reduced-motion', true); return { transition, note: '720 CSS px reflow only; browser text zoom and assistive technology are not claimed.' };
  });
  await run('no-external-requests-or-page-errors', async () => {
    const external = requests.filter(r => !r.url.startsWith(`${new URL(base).origin}/`) && !r.url.startsWith('data:'));
    assert.deepEqual(external, []); assert.deepEqual(pageErrors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(httpErrors, []);
    check(requests.every(r => r.method === 'GET'), 'No writes or sends requested');
    return { requests: requests.length, externalRequests: external.length, pageErrors, consoleErrors, methods: [...new Set(requests.map(r => r.method))] };
  });
} finally {
  const summary = { generatedAt: new Date().toISOString(), base, browser: await browser.version(), results, screenshots, requests, pageErrors, consoleErrors, httpErrors,
    passed: results.filter(r => r.status === 'PASS').length, failed: results.filter(r => r.status === 'FAIL').length };
  writeFileSync(resolve(out, reportName), JSON.stringify(summary, null, 2));
  console.log(`Use-case browser QA: ${summary.passed} passed, ${summary.failed} failed. Evidence: artifacts/use-cases/${reportName}`);
  await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  if (summary.failed) process.exitCode = 1;
}
