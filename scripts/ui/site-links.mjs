import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { launch } from './cdp.mjs';

// A focused regression check against the actual previous public page's section IDs.
// Serve site/ locally before running. No records, submissions or external effects are generated.
const origin = process.env.OATHRA_SITE_PREVIEW ?? 'http://127.0.0.1:8768';
assert(new URL(origin).hostname === '127.0.0.1', 'A local site preview is required.');
const output = resolve('docs/quality/evidence/2026-10-02-craft/site-legacy-links.json');
assert(!existsSync(output), 'Existing evidence is immutable.');
const report = { capturedAt: new Date().toISOString(), baseline: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), checks: [] };
let page;
try {
  page = await launch();
  for (const [lang, path, source] of [['ja', '/', 'site/index.html'], ['en', '/en/', 'site/en/index.html']]) {
    const previous = execFileSync('git', ['show', `HEAD:${source}`], { encoding: 'utf8' });
    const ids = [...new Set([...previous.matchAll(/<section\b[^>]*\bid="([^"]+)"/g)].map(match => match[1]).concat(['sim', 'rec', 'player']))];
    for (const id of ids) {
      await page.goto(`${origin}${path}#${id}`);
      await page.until("!!document.getElementById(location.hash.slice(1))", { label: `${lang} legacy ${id}`, timeout: 10000 });
      const target = await page.js('location.pathname + location.hash');
      report.checks.push({ language: lang, previous: `#${id}`, target, status: 'PASS' });
    }
  }
  assert.equal(page.pageErrors.length, 0);
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.error = error.message; process.exitCode = 1;
} finally {
  if (page) await page.close();
  report.legacySha256 = createHash('sha256').update(readFileSync('site/legacy.js')).digest('hex');
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, error: report.error, evidence: output }));
}
