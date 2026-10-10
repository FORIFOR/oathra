// Real SQLite / authenticated Gateway. All examples are synthetic; no workers,
// phone sessions, AI calls, customer data, or external services are used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { Store } from '../lib/store.mjs';
import { Service } from '../lib/service.mjs';
import { hash } from '../lib/security.mjs';
import { configuration, createGateway } from '../server.mjs';
import { IntakePilot, candidateFields, INTAKE_KIND } from '../lib/intake-pilot.mjs';

const NOW = Date.parse('2026-10-05T10:00:00Z');
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'oathra-intake-')), key = randomBytes(32).toString('hex');
  const token = randomBytes(32).toString('hex'), otherToken = randomBytes(32).toString('hex');
  const user = { id: 'pilot-operator', team: 'local', role: 'operator', tokenHash: hash(token) };
  const other = { id: 'other-operator', team: 'local', role: 'operator', tokenHash: hash(otherToken) };
  const config = configuration({ OATHRA_USERS_JSON: JSON.stringify([user, other]), OATHRA_DATA_KEY: key, OATHRA_DB: join(dir, 'db.sqlite') });
  const store = new Store(config.dbPath, key, () => NOW), service = new Service(store, config), pilot = new IntakePilot(service);
  const create = (fixtureId = 'complete') => pilot.create(user, { fixtureId, synthetic: true });
  const change = (c, action, extra = {}) => pilot.change(user, c.id, { revision: c.revision, action, acknowledged: true, ...extra });
  return { dir, key, token, otherToken, config, store, service, pilot, user, other, create, change,
    close() { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const using = fn => async () => { const f = setup(); try { await fn(f); } finally { f.close(); } };

test('only a unique, exact customer span can supply a field; AI, unknown, aliases and duplicates cannot', () => {
  const proposed = [{ field: 'contact', value: 'デモ折り返し先 A', turnId: 't' }];
  for (const source of ['assistant', 'unknown', 'Observer', 'caller', 'callee', '', null]) {
    assert.equal(candidateFields([{ id: 't', source, text: 'デモ折り返し先 A' }], proposed).contact.value, null);
  }
  assert.equal(candidateFields([{ id: 't', source: 'customer', text: 'デモ折り返し先 A' }], proposed).contact.value, 'デモ折り返し先 A');
  assert.equal(candidateFields([{ id: 't', source: 'customer', text: '違う回答' }], proposed).contact.value, null);
  assert.equal(candidateFields([{ id: 't', source: 'customer', text: 'デモ折り返し先 A' }, { id: 't', source: 'unknown', text: 'デモ折り返し先 A' }], proposed).contact.value, null);
  assert.equal(candidateFields([{ id: 't', source: 'customer', text: 'デモ折り返し先 A' }], [...proposed, ...proposed]).contact.value, null);
});

test('empty -> durable synthetic case; repeated import has one id and no phone/job/contact side effects', using(f => {
  assert.equal(f.pilot.list(f.user).cases.length, 0);
  const c = f.create(); assert.equal(c.status, 'unhandled'); assert.equal(c.reviewState, 'needs_review');
  assert.equal(f.create().id, c.id); assert.equal(f.pilot.list(f.user).cases.length, 1);
  assert.equal(f.store.list('mission').length, 0); assert.equal(f.store.list('contact').length, 0); assert.equal(f.store.list('job').length, 0);
  const reopened = new Store(f.config.dbPath, f.key);
  try { assert.deepEqual(reopened.get(INTAKE_KIND, c.id), c); } finally { reopened.close(); }
  assert.ok(!readFileSync(f.config.dbPath).includes(Buffer.from('洗面台')));
}));

test('fixed fixtures are the only accepted input, with no real transcript/contact field', using(f => {
  for (const data of [{ fixtureId: 'complete' }, { synthetic: true, fixtureId: 'custom' }, { synthetic: true, fixtureId: 'complete', transcript: [] }, { synthetic: true, fixtureId: 'complete', phone: '+819000000000' }]) {
    assert.throws(() => f.pilot.create(f.user, data), /intake_synthetic_fixture_required/);
  }
  assert.equal(f.store.list(INTAKE_KIND).length, 0);
}));

test('human confirmation, assignment, queue and resolution are distinct explicit transactions', using(f => {
  let c = f.create();
  assert.throws(() => f.change(c, 'queue'), /intake_review_required/);
  assert.throws(() => f.change(c, 'done', { outcome: 'handed_over' }), /intake_callback_required/);
  assert.throws(() => f.pilot.change(f.user, c.id, { revision: c.revision, action: 'confirm' }), /intake_explicit_action_required/);
  c = f.change(c, 'confirm'); assert.equal(c.reviewState, 'confirmed'); assert.equal(c.status, 'unhandled');
  assert.throws(() => f.change(c, 'queue'), /intake_assignment_required/);
  c = f.change(c, 'assign', { assignee: 'demo_a', dueAt: NOW + 3600_000 });
  assert.equal(c.status, 'unhandled'); c = f.change(c, 'queue'); assert.equal(c.status, 'callback_pending');
  assert.throws(() => f.change(c, 'done', { outcome: 'no_answer' }), /intake_resolution_required/);
  // A missed call keeps the queue pending; only a new deadline is recorded.
  c = f.change(c, 'assign', { assignee: 'demo_b', dueAt: NOW + 7200_000 }); assert.equal(c.status, 'callback_pending');
  c = f.change(c, 'done', { outcome: 'handed_over' }); assert.equal(c.status, 'done');
  assert.equal(c.resolution.externallyVerified, false); assert.equal(c.resolution.source, 'human_demo_report');
  assert.throws(() => f.change(c, 'done', { outcome: 'handed_over' }), /intake_callback_required/);
  c = f.change(c, 'reopen'); assert.equal(c.status, 'unhandled'); assert.equal(c.reviewState, 'needs_review'); assert.equal(c.resolution, null);
  assert.deepEqual(c.history.map(h => h.action), ['created', 'confirm', 'assign', 'queue', 'assign', 'done', 'reopen']);
  assert.ok(c.history.every(h => h.actor === f.user.id));
}));

for (const fixture of ['missing', 'unknown']) test(`${fixture} remains needs-review despite the AI claiming completion`, using(f => {
  let c = f.create(fixture); assert.equal(c.fields.contact.value, null);
  assert.throws(() => f.change(c, 'confirm'), /intake_missing_customer_evidence/);
  c = f.change(c, 'assign', { assignee: 'demo_a', dueAt: NOW + 3600_000 });
  assert.throws(() => f.change(c, 'queue'), /intake_review_required/);
  assert.equal(f.store.get(INTAKE_KIND, c.id).status, 'unhandled');
}));

test('past/oversized/invalid deadlines, fake operators and unknown commands fail without state changes', using(f => {
  const c = f.create();
  for (const dueAt of [NOW, NOW - 1, NOW + 31 * 86400_000, 'tomorrow', null]) assert.throws(() => f.change(c, 'assign', { assignee: 'demo_a', dueAt }), /intake_future_due_required/);
  assert.throws(() => f.change(c, 'assign', { assignee: '__proto__', dueAt: NOW + 10000 }), /intake_assignee_required/);
  assert.throws(() => f.change(c, 'assign', { assignee: 'Real Name', dueAt: NOW + 10000 }), /intake_assignee_required/);
  assert.throws(() => f.change(c, 'autofinish'), /intake_invalid_action/);
  assert.throws(() => f.change(c, 'confirm', { status: 'done' }), /intake_invalid_action/);
  assert.deepEqual(f.store.get(INTAKE_KIND, c.id), c);
}));

test('enum-shaped arrays, objects and scalars cannot be persisted as an assignee or outcome', using(f => {
  let c = f.create();
  const invalid = [[], ['demo_a'], [['handed_over']], {}, 0, true, null];
  for (const assignee of invalid) {
    const audits = f.store.audits().length;
    assert.throws(() => f.change(c, 'assign', { assignee, dueAt: NOW + 10000 }), /intake_assignee_required/);
    assert.deepEqual(f.store.get(INTAKE_KIND, c.id), c); assert.equal(f.store.audits().length, audits);
  }
  c = f.change(c, 'confirm'); c = f.change(c, 'assign', { assignee: 'demo_a', dueAt: NOW + 10000 }); c = f.change(c, 'queue');
  for (const outcome of [...invalid, ['handed_over']]) {
    const audits = f.store.audits().length;
    assert.throws(() => f.change(c, 'done', { outcome }), /intake_resolution_required/);
    assert.deepEqual(f.store.get(INTAKE_KIND, c.id), c); assert.equal(f.store.audits().length, audits);
  }
}));

const browserSource = readFileSync(new URL('../public/intake-pilot/app.js', import.meta.url), 'utf8');
test('the actual served browser script parses even when the build only copies assets', () => {
  assert.doesNotThrow(() => new vm.Script(browserSource));
});

// Pure in-memory logic harness, not a browser or a substitute for visual/DOM QA.
function uiHarness(fetch) {
  const events = {}, controls = ['filter', 'navigation', 'confirm'].map(id => ({ id, disabled: false, value: id === 'filter' ? 'all' : '', dataset: {}, classList: { contains: c => id === 'navigation' && c === 'case-button', toggle() {} }, addEventListener() {} }));
  const nodes = new Map(controls.map(c => ['#' + c.id, c]));
  for (const id of ['refresh', 'feedback', 'workspace', 'fixture', 'add', 'case-detail', 'unavailable']) nodes.set('#' + id, { dataset: {}, classList: { toggle() {} }, setAttribute() {}, addEventListener() {}, focus() {} });
  const context = vm.createContext({ fetch, console, location: { hash: '#case-a' }, history: { replacements: [], replaceState(_a, _b, hash) { this.replacements.push(hash); context.location.hash = hash; } }, document: { querySelector: id => nodes.get(id), querySelectorAll: () => controls }, window: { addEventListener: (name, fn) => { events[name] = fn; } } });
  vm.runInContext(browserSource.replace(/void load\(\);\s*$/, ''), context);
  vm.runInContext('render = () => {};', context);
  return { context, controls, events, run: source => vm.runInContext(source, context) };
}
test('read-only and uncertain-result states still permit case navigation and filtering', () => {
  const h = uiHarness(); h.run('writable=false; busy=false; lock();');
  assert.equal(h.controls[0].disabled, false); assert.equal(h.controls[1].disabled, false); assert.equal(h.controls[2].disabled, true);
  h.run('writable=true; uncertain=true; lock();');
  assert.equal(h.controls[0].disabled, false); assert.equal(h.controls[1].disabled, false); assert.equal(h.controls[2].disabled, true);
});
test('a delayed save reconciles its row but does not replace newer Back/Forward navigation', async () => {
  let release;
  const h = uiHarness(() => new Promise(resolve => { release = resolve; }));
  h.run('writable=true; data={cases:[{id:"case-a", revision:1},{id:"case-b", revision:1}]};');
  const saving = h.run('mutate("/intake-pilot/case-a", {action:"confirm"}, "saved");');
  h.context.location.hash = '#case-b'; h.events.hashchange();
  release({ ok: true, json: async () => ({ id: 'case-a', revision: 2 }) }); await saving;
  assert.equal(h.context.location.hash, '#case-b'); assert.equal(h.context.history.replacements.length, 0);
  assert.equal(h.run('data.cases.find(c=>c.id==="case-a").revision'), 2);
});
test('Back to a hashless list preserves its effective selection when a delayed existing-row save finishes', async () => {
  let release;
  const h = uiHarness(() => new Promise(resolve => { release = resolve; }));
  h.run('writable=true; data={cases:[{id:"case-b", revision:1},{id:"case-a", revision:1}]};');
  const saving = h.run('mutate("/intake-pilot/case-a", {action:"confirm"}, "saved");');
  h.context.location.hash = ''; h.events.hashchange();
  release({ ok: true, json: async () => ({ id: 'case-a', revision: 2 }) }); await saving;
  assert.equal(h.context.location.hash, ''); assert.equal(h.context.history.replacements.length, 0);
  assert.equal(h.run('data.cases[0].id'), 'case-b');
  assert.equal(h.run('data.cases.find(c=>c.id==="case-a").revision'), 2);
});
test('a delayed first import also preserves newer hashless selection instead of prepending over it', async () => {
  let release;
  const h = uiHarness(() => new Promise(resolve => { release = resolve; }));
  h.run('writable=true; data={cases:[{id:"case-b", revision:1},{id:"case-a", revision:1}]};');
  const saving = h.run('mutate("/intake-pilot", {fixtureId:"unknown",synthetic:true}, "saved");');
  h.context.location.hash = ''; h.events.hashchange();
  release({ ok: true, json: async () => ({ id: 'case-c', revision: 1 }) }); await saving;
  assert.equal(h.context.location.hash, ''); assert.equal(h.context.history.replacements.length, 0);
  assert.equal(h.run('data.cases[0].id'), 'case-b'); assert.equal(h.run('data.cases[2].id'), 'case-c');
});

test('a stale revision cannot overwrite another operator action; time alone never completes a case', using(f => {
  const old = f.create(), confirmed = f.change(old, 'confirm');
  assert.throws(() => f.change(old, 'assign', { assignee: 'demo_a', dueAt: NOW + 3600_000 }), /intake_changed_reload/);
  assert.deepEqual(f.store.get(INTAKE_KIND, old.id), confirmed);
  f.store.now = () => NOW + 86400_000;
  assert.equal(f.pilot.list(f.user).cases[0].status, 'unhandled');
}));

test('owners are isolated; viewers cannot mutate; live mode rejects both reads and writes', using(f => {
  const c = f.create(); assert.deepEqual(f.pilot.list(f.other).cases, []);
  assert.throws(() => f.pilot.change(f.other, c.id, { revision: 1, action: 'confirm', acknowledged: true }), /not_found/);
  assert.throws(() => f.pilot.create({ ...f.user, role: 'viewer' }, { fixtureId: 'complete', synthetic: true }), /read_only_account/);
  assert.throws(() => f.pilot.change({ ...f.user, role: 'viewer' }, c.id, { revision: 1, action: 'confirm', acknowledged: true }), /read_only_account/);
  f.config.mode = 'live'; assert.throws(() => f.pilot.list(f.user), /intake_pilot_simulator_only/); assert.throws(() => f.create(), /intake_pilot_simulator_only/);
  assert.throws(() => f.change(c, 'confirm'), /intake_pilot_simulator_only/);
}));

test('save failure rolls back record, history and audit; same action can be retried', using(f => {
  let c = f.create(), auditCount = f.store.audits().length;
  f.store.db.exec("CREATE TEMP TRIGGER fail_intake BEFORE INSERT ON records WHEN NEW.kind='intake-pilot' BEGIN SELECT RAISE(ABORT,'synthetic storage failure'); END");
  assert.throws(() => f.change(c, 'confirm'), /synthetic storage failure/);
  assert.deepEqual(f.store.get(INTAKE_KIND, c.id), c); assert.equal(f.store.audits().length, auditCount);
  f.store.db.exec('DROP TRIGGER fail_intake'); c = f.change(c, 'confirm'); assert.equal(c.revision, 2);
}));

test('HTTP routes enforce authentication, owner boundaries, same-origin browser mutations and live gate', using(async f => {
  const app = await createGateway(f.config, { store: f.store, env: {} });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`; f.config.publicUrl = base;
  const call = (path = '', body, token = f.token, extra = {}) => fetch(base + '/v1/intake-pilot' + path, { method: body ? 'POST' : 'GET', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    assert.equal((await call('', undefined, null)).status, 401);
    assert.equal((await call('', { fixtureId: 'complete', synthetic: true }, f.token, { origin: 'https://elsewhere.test' })).status, 403);
    const created = await call('', { fixtureId: 'complete', synthetic: true }); assert.equal(created.status, 201); const c = await created.json();
    assert.equal((await call(`/${c.id}`, { revision: c.revision, action: 'confirm', acknowledged: true }, f.otherToken)).status, 404);
    assert.equal((await call(`/${c.id}`, { revision: c.revision, action: 'confirm', acknowledged: true })).status, 200);
    assert.equal((await call(`/${c.id}`, { revision: c.revision, action: 'confirm', acknowledged: true })).status, 409);
    assert.equal((await (await call()).json()).cases[0].status, 'unhandled');
    assert.equal((await fetch(base + '/intake-pilot')).status, 200);
    f.config.mode = 'live'; assert.equal((await call()).status, 409);
  } finally { await app.close(); }
}));
