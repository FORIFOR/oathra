import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { launch } from './cdp.mjs';

const origin = process.env.OATHRA_SITE_PREVIEW ?? 'http://127.0.0.1:8768';
assert(new URL(origin).hostname === '127.0.0.1');
const output = 'docs/quality/evidence/2026-10-02-craft/site-local-analytics.json';
assert(!existsSync(output), 'Do not overwrite existing evidence.');
const report = { capturedAt: new Date().toISOString(), source: 'Existing published evidence-lab choices. No new transcript or fixture.', checks: [] };
const page = await launch({ width: 1440, height: 1000 });
try {
  for (const path of ['/lab.html#sim', '/en/lab.html#sim']) {
    await page.goto(origin + path);
    await page.until("document.querySelectorAll('#s-chips button').length===4", { label: 'existing evidence lab' });
    assert.equal(await page.js("document.querySelector('#s-res').classList.contains('ok')"), false);
    await page.js("document.querySelector('#s-chips button:nth-child(3)').scrollIntoView({block:'center'})");
    await page.tap('#s-chips button:nth-child(3)');
    await page.until("document.querySelector('#s-res').classList.contains('ok')", { label: 'existing published confirmation is checked' });
    // Resource Timing observes actual completed requests. No fetch interception or stubs.
    await page.js('new Promise(resolve=>setTimeout(resolve,700))');
    const metricRequests = await page.js("performance.getEntriesByType('resource').filter(entry=>entry.name.includes('/api/site/events')).map(entry=>entry.name)");
    assert.deepEqual(metricRequests, []);
    report.checks.push({ path, existingLabTransition: 'incomplete -> complete', metricRequests: 0, status: 'PASS' });
  }
  assert.equal(page.pageErrors.length, 0);
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.error = error.message; process.exitCode = 1;
} finally {
  await page.close();
  report.portfolioSha256 = createHash('sha256').update(readFileSync('site/portfolio.js')).digest('hex');
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, error: report.error, evidence: output }));
}
