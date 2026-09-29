// Core-boundary regression checks from the independent implementation audit.
// Temporary identities/records are limited to approval, authentication and contact persistence.
// Real in-memory SQLite and loopback HTTP are used; no worker, external provider or call starts.
// Every fixture closes its server/database in finally; no test data survives the run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { configuration, createGateway } from '../server.mjs';
import { Store } from '../lib/store.mjs';
import { Service } from '../lib/service.mjs';
import { hash } from '../lib/security.mjs';

const RECIPIENT = '+15005550006';

function fixture() {
  let now = Date.now();
  const tokens = [randomBytes(32).toString('hex'), randomBytes(32).toString('hex')];
  const users = tokens.map((token, index) => ({ id: randomUUID(), team: 'local', role: index ? 'operator' : 'admin', tokenHash: hash(token) }));
  const config = configuration({
    OATHRA_USERS_JSON: JSON.stringify(users), OATHRA_DATA_KEY: randomBytes(32).toString('hex'),
    OATHRA_DB: ':memory:', OATHRA_DEPLOYMENT: 'managed', OATHRA_CREDITS_PER_CALL: '3',
  });
  const store = new Store(':memory:', config.dataKey, () => now);
  return { config, store, users: config.users, tokens, advance(ms) { now += ms; } };
}

function usingApproval(fn) {
  return async () => {
    const f = fixture(), service = new Service(f.store, f.config);
    // Exercise the real paid-approval reservation boundary without starting an executor.
    Object.assign(f.config, { mode: 'live', liveReady: true, callerId: RECIPIENT });
    const inputs = f.users.map(user => {
      service.saveConsent(user, f.config.consentVersion);
      service.credits.grant(f.users[0], user.id, 30, randomUUID(), 'Local approval-boundary test');
      const product = service.product(user, { name: 'Approval boundary', facts: 'Local verification only.', reviewed: true });
      const contact = service.contact(user, { name: 'Recipient boundary', phone: RECIPIENT, relationship: 'inquiry', basis: 'Local verification only.' });
      return { request: 'Local approval-boundary check', productId: product.id, contactId: contact.id };
    });
    const draft = index => service.prepare(f.users[index], inputs[index]);
    try { await fn({ ...f, service, draft }); } finally { f.store.close(); }
  };
}

for (const status of ['QUEUED', 'DIALING', 'ACTIVE', 'UNKNOWN', 'CANCEL_REQUESTED', 'HANDOFF_PENDING', 'HANDOFF_ACTIVE', 'VERIFYING']) {
  test(`approval rejects another owner's ${status} call to the same number before reserving credits`, usingApproval(f => {
    const previous = f.draft(0); previous.status = status; f.store.put('mission', previous);
    const next = f.draft(1), owner = f.users[1], review = f.service.review(owner, next.id);
    assert.throws(() => f.service.start(owner, review.approvalToken, randomUUID(), true, next.id), /recipient_has_active_call/);
    assert.equal(f.store.get('mission', next.id).status, 'DRAFT');
    assert.deepEqual({ ...f.service.credits.balance(owner.id) }, { available: 30, held: 0 });
    assert.equal(f.store.get('reservation', next.id), null);
    assert.ok(f.store.key('approval', hash(review.approvalToken)), 'rejection does not consume approval');
  }));
}

test('a terminal record needing stop reconciliation still blocks, then confirmed completion permits one reservation', usingApproval(f => {
  const previous = f.draft(0); Object.assign(previous, { status: 'CANCELLED', stopNeedsReconciliation: true }); f.store.put('mission', previous);
  const next = f.draft(1), owner = f.users[1], review = f.service.review(owner, next.id), key = randomUUID();
  assert.throws(() => f.service.start(owner, review.approvalToken, key, true, next.id), /recipient_has_active_call/);
  previous.stopNeedsReconciliation = false; f.store.put('mission', previous);
  assert.equal(f.service.start(owner, review.approvalToken, key, true, next.id).status, 'QUEUED');
  assert.equal(f.service.start(owner, review.approvalToken, key, true, next.id).id, next.id);
  assert.deepEqual({ ...f.service.credits.balance(owner.id) }, { available: 27, held: 3 });
  assert.equal(f.service.credits.history(owner.id).filter(e => e.kind === 'reserve').length, 1);
}));

test('an old UNKNOWN outside the 1000-item history page still prevents redial', usingApproval(f => {
  const previous = f.draft(0); previous.status = 'UNKNOWN'; f.store.put('mission', previous);
  f.advance(1);
  f.store.tx(() => {
    for (let i = 0; i < 1001; i++) f.store.put('mission', {
      id: randomUUID(), owner: previous.owner, status: 'COMPLETED', target: { phone: '+15005550007' },
    });
  });
  assert.equal(f.store.list('mission', previous.owner).some(m => m.id === previous.id), false);
  const next = f.draft(0), review = f.service.review(f.users[0], next.id);
  assert.throws(() => f.service.start(f.users[0], review.approvalToken, randomUUID(), true), /recipient_has_active_call/);
  assert.deepEqual({ ...f.service.credits.balance(previous.owner) }, { available: 30, held: 0 });
}));

async function usingHttp(fn) {
  const f = fixture();
  let app;
  try {
    app = await createGateway(f.config, { store: f.store, env: {} });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + app.server.address().port;
    f.config.publicUrl = base;
    const request = (path, { method = 'GET', headers = {}, body } = {}) => fetch(base + '/v1' + path, {
      method, headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const bearer = index => ({ authorization: 'Bearer ' + f.tokens[index] });
    const login = async () => {
      const response = await request('/session', { method: 'POST', headers: { ...bearer(0), origin: base }, body: {} });
      assert.equal(response.status, 200);
      return response.headers.get('set-cookie').split(';')[0];
    };
    await fn({ ...f, app, base, request, bearer, login });
  } finally {
    if (app) await app.close();
    f.store.close();
  }
}

async function streamEnds(reader) {
  let timer;
  try {
    return await Promise.race([
      (async () => {
        let received = '';
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) return received;
          received += new TextDecoder().decode(chunk.value);
        }
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('revoked SSE remained open')), 5000); }),
    ]);
  } finally { clearTimeout(timer); }
}

for (const cause of ['logout', 'session expiry', 'cookie credential rotation', 'bearer credential rotation', 'password change', 'owner change', 'mission deletion']) {
  test(`an existing SSE closes without further disclosure after ${cause}`, { timeout: 10000 }, () => usingHttp(async f => {
    let password;
    if (cause === 'password change') {
      password = randomBytes(16).toString('hex');
      const invite = f.app.service.passwords.issue(f.users[0].id);
      const code = new URLSearchParams(new URL(invite.url).hash.slice(1)).get('setup');
      await f.app.service.passwords.enroll({ code, email: randomUUID() + '@example.invalid', password }, 'local-boundary');
    }
    const cookie = await f.login(), bearerAuth = cause === 'bearer credential rotation';
    const headers = bearerAuth ? f.bearer(0) : { cookie };
    const mission = { id: randomUUID(), owner: f.users[0].id, status: 'ACTIVE' };
    f.store.put('mission', mission);
    f.store.event(mission, { type: 'boundary-marker', text: 'authorized-event' });
    const response = await f.request('/missions/' + mission.id + '/events', { headers });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    try {
      assert.match(new TextDecoder().decode((await reader.read()).value), /authorized-event/);
      if (cause === 'logout') {
        assert.equal((await f.request('/session', { method: 'DELETE', headers: { cookie, origin: f.base } })).status, 200);
      } else if (cause === 'session expiry') {
        f.advance(8 * 3600000);
      } else if (cause.includes('credential rotation')) {
        f.users[0].tokenHash = hash(randomUUID());
      } else if (cause === 'password change') {
        await f.app.service.passwords.change(f.users[0], { currentPassword: password, newPassword: password + 'changed' }, 'local-boundary');
      } else if (cause === 'owner change') {
        f.store.put('mission', { ...mission, owner: f.users[1].id });
      } else {
        f.store.removeMission(mission);
      }
      const expectedStatus = ['owner change', 'mission deletion'].includes(cause) ? 404 : 401;
      assert.equal((await f.request('/missions/' + mission.id, { headers })).status, expectedStatus);
      // Keep the original event owner so this probes revalidation, not just the query's owner filter.
      f.store.event(mission, { type: 'boundary-marker', text: 'post-revocation-event' });
      assert.doesNotMatch(await streamEnds(reader), /post-revocation-event/);
    } finally { await reader.cancel(); }
  }));
}

test('managed contact edits preserve hidden sales/SDK metadata and explicit empty fields clear it', () => usingHttp(async f => {
  const create = await f.request('/contacts', { method: 'POST', headers: f.bearer(0), body: {
    name: 'SDK contact', company: 'Compatibility boundary', phone: RECIPIENT, relationship: 'customer',
    basis: 'Requested contact, local test only.', crmId: '12345', simulationOnly: true,
    email: 'contact@example.invalid', notes: 'Visible notes', lastCallNotes: 'No real call made.',
  } });
  assert.equal(create.status, 201); const original = await create.json();
  const body = { id: original.id };
  for (const field of ['name', 'company', 'phone', 'email', 'notes', 'lastCallNotes']) body[field] = original[field];
  body.name = 'Managed edited contact';
  const edited = await f.request('/contacts', { method: 'POST', headers: f.bearer(0), body });
  assert.equal(edited.status, 201); const saved = await edited.json();
  for (const field of ['relationship', 'basis', 'crmId', 'simulationOnly']) assert.equal(saved[field], original[field], field);
  assert.deepEqual(f.store.get('contact', original.id), saved);
  const product = f.app.service.product(f.users[0], { name: 'Compatibility', facts: 'Local verification only.', reviewed: true });
  const mission = f.app.service.prepare(f.users[0], { request: 'Compatibility boundary', productId: product.id, contactId: saved.id });
  assert.equal(f.app.service.review(f.users[0], mission.id).mission.id, mission.id);
  const cleared = await f.request('/contacts', { method: 'POST', headers: f.bearer(0), body: {
    id: saved.id, relationship: '', basis: '', crmId: '', phone: '', simulationOnly: false,
  } });
  assert.equal(cleared.status, 201); const current = await cleared.json();
  for (const field of ['relationship', 'basis', 'crmId', 'phone']) assert.equal(current[field], '');
  assert.equal(current.simulationOnly, false);
  assert.equal(current.name, saved.name);
  assert.equal(current.notes, saved.notes);
}));

test('partial contact updates cannot cross owners or change record ownership', () => usingHttp(async f => {
  const contact = f.app.service.contact(f.users[0], { name: 'Owner-bound contact', relationship: 'customer', basis: 'Local test only.' });
  const denied = await f.request('/contacts', { method: 'POST', headers: f.bearer(1), body: { id: contact.id, name: 'Changed' } });
  assert.equal(denied.status, 404);
  assert.deepEqual(f.store.get('contact', contact.id), contact);
  const own = await f.request('/contacts', { method: 'POST', headers: f.bearer(0), body: { id: contact.id, owner: f.users[1].id, name: 'Updated own contact' } });
  assert.equal(own.status, 201);
  assert.equal((await own.json()).owner, f.users[0].id);
}));

test('contact creation with the same idempotency key is persisted and audited once', () => usingHttp(async f => {
  const key = randomUUID(), body = { name: 'Contact save response-loss boundary', notes: 'Private local persistence marker' };
  const request = () => f.request('/contacts', { method: 'POST', headers: { ...f.bearer(0), 'idempotency-key': key }, body });
  const replies = await Promise.all([request(), request()]);
  assert.deepEqual(replies.map(r => r.status), [201, 201]);
  const records = await Promise.all(replies.map(r => r.json()));
  assert.deepEqual(records[0], records[1]);
  assert.equal(f.store.list('contact', f.users[0].id).length, 1);
  assert.equal(f.store.audits().filter(a => a.action === 'contact.saved').length, 1);
  const retained = f.store.key('contact-save:' + f.users[0].id, key);
  assert.ok(retained);
  assert.ok(!retained.includes(body.name) && !retained.includes(body.notes), 'replay payload remains encrypted');
}));

test('contact idempotency keys reject changed payloads and are scoped to the owner', () => usingHttp(async f => {
  const key = randomUUID(), body = { name: 'Owner-scoped contact replay' };
  const save = (owner, payload) => f.request('/contacts', { method: 'POST', headers: { ...f.bearer(owner), 'idempotency-key': key }, body: payload });
  const first = await save(0, body); assert.equal(first.status, 201); const original = await first.json();
  const conflict = await save(0, { ...body, name: 'Different request' });
  assert.equal(conflict.status, 409); assert.equal((await conflict.json()).error, 'idempotency_conflict');
  assert.deepEqual(f.store.get('contact', original.id), original);
  const second = await save(1, body); assert.equal(second.status, 201); const other = await second.json();
  assert.notEqual(other.id, original.id); assert.equal(other.owner, f.users[1].id);
  assert.equal(f.store.list('contact', f.users[0].id).length, 1);
  assert.equal(f.store.list('contact', f.users[1].id).length, 1);
}));

test('a rejected contact save leaves its key reusable, but replay still requires write permission', () => usingHttp(async f => {
  const key = randomUUID(), headers = { ...f.bearer(0), 'idempotency-key': key };
  const invalid = await f.request('/contacts', { method: 'POST', headers, body: { name: '' } });
  assert.equal(invalid.status, 400); assert.equal(f.store.key('contact-save:' + f.users[0].id, key), undefined);
  const body = { company: 'Corrected contact' };
  assert.equal((await f.request('/contacts', { method: 'POST', headers, body })).status, 201);
  f.users[0].role = 'viewer';
  assert.equal((await f.request('/contacts', { method: 'POST', headers, body })).status, 403);
  assert.equal(f.store.list('contact', f.users[0].id).length, 1);
}));

test('replaying a completed contact update cannot roll back a later saved edit', () => usingHttp(async f => {
  const contact = f.app.service.contact(f.users[0], { name: 'Original contact' });
  const key = randomUUID(), body = { id: contact.id, name: 'First edit' };
  const first = await f.request('/contacts', { method: 'POST', headers: { ...f.bearer(0), 'idempotency-key': key }, body });
  assert.equal(first.status, 201); const originalReply = await first.json();
  const later = f.app.service.contact(f.users[0], { id: contact.id, name: 'Later edit' }, randomUUID());
  const replay = await f.request('/contacts', { method: 'POST', headers: { ...f.bearer(0), 'idempotency-key': key }, body });
  assert.equal(replay.status, 201); assert.deepEqual(await replay.json(), originalReply);
  assert.deepEqual(f.store.get('contact', contact.id), later);
  assert.equal(f.store.audits().filter(a => a.action === 'contact.saved').length, 3);
}));
