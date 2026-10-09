import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createAgentMcp, AGENT_TOOLS, gatewayOrigin } from '../lib/agent-mcp.mjs';

const id = '12345678-1234-1234-1234-123456789abc';
const key = 'private-test-key-not-a-real-credential';
const phone = { phone: '+819000000000', name: '架空のテスト相手', instruction: '明日の受付時間を確認する' };
const mission = (status = 'DRAFT') => ({ id, kind: 'phone-request', status, mode: 'simulator', phoneRequest: phone, maxSeconds: 60, maxUsd: 1, creditQuote: { amount: 0 }, result: null });
const req = (name, args = {}, n = 2) => ({ jsonrpc: '2.0', id: n, method: 'tools/call', params: { name, arguments: args } });
async function initialized(fetchImpl) {
  const server = createAgentMcp({ baseUrl: 'http://127.0.0.1:4244', token: key, fetchImpl });
  await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  return server;
}
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

test('negotiates both known MCP versions and never claims an unsupported requested version', async () => {
  for (const version of ['2025-06-18', '2025-03-26', '2099-01-01']) {
    const s = createAgentMcp({ baseUrl: '', token: '' });
    const result = await s.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: version } });
    assert.equal(result.result.protocolVersion, version === '2099-01-01' ? '2025-06-18' : version);
    assert.equal(await s.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined);
  }
});
test('requires initialization and exposes no approve/start/cancel/payment tool', async () => {
  const s = createAgentMcp({ baseUrl: '', token: '' });
  assert.equal((await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).error.code, -32002);
  assert.deepEqual(AGENT_TOOLS.map(t => t.name), ['oathra_list', 'oathra_draft', 'oathra_status', 'oathra_phone_capabilities', 'oathra_phone_draft', 'oathra_phone_result']);
});
test('rejects unknown tools and privilege-bearing arguments before any request', async () => {
  let count = 0; const s = await initialized(() => { count++; throw new Error('must not call'); });
  for (const [name, args] of [['oathra_start', { id }], ['oathra_phone_draft', { ...phone, approved: true }], ['oathra_phone_draft', { ...phone, baseUrl: 'https://evil.example' }], ['oathra_phone_result', { id: '../start' }], ['oathra_phone_result', { id, includeTranscript: 'true' }]]) {
    assert.equal((await s.handle(req(name, args))).result.isError, true);
  }
  assert.equal(count, 0);
});
test('draft is projected without the approval token, and a draft never calls start', async () => {
  const calls = []; const s = await initialized(async (url, init) => {
    calls.push({ url, init }); return json({ mission: mission(), approvalToken: 'DO-NOT-EXPOSE', expiresInSeconds: 300, nested: { token: key } }, 201);
  });
  const result = (await s.handle(req('oathra_phone_draft', phone))).result;
  assert.equal(result.structuredContent.missionId, id);
  assert.equal(result.structuredContent.dialed, false);
  assert.equal(result.structuredContent.status, 'DRAFT');
  assert.equal(result.structuredContent.humanReview.missionId, id);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:4244/v1/phone/draft');
  assert.deepEqual(JSON.parse(calls[0].init.body), phone);
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.headers.authorization, 'Bearer ' + key);
  assert.ok(!JSON.stringify(result).includes('DO-NOT-EXPOSE'));
  assert.ok(!JSON.stringify(result).includes(key));
});
test('ended and incomplete remain distinct; transcript is opt-in', async () => {
  const s = await initialized(async url => url.includes('/missions/')
    ? json({ ...mission('INCOMPLETE'), result: { status: 'incomplete', caveat: '未確定です' } })
    : json({ id, state: 'ended', memory: { bookingStatus: 'not_confirmed' }, transcript: [{ text: '機密な会話' }], voiceSetting: { voiceSent: 'Kore' } }));
  const result = (await s.handle(req('oathra_phone_result', { id }))).result.structuredContent;
  assert.equal(result.status, 'INCOMPLETE'); assert.equal(result.state, 'ended');
  assert.equal(result.result.status, 'incomplete');
  assert.equal(result.transcript, undefined);
  assert.ok(!JSON.stringify(result).includes('機密な会話'));
  assert.equal((await s.handle(req('oathra_phone_result', { id, includeTranscript: true }))).result.structuredContent.transcript.length, 1);
});
test('unknown stays unknown and mismatched IDs fail closed', async () => {
  const s = await initialized(async url => url.includes('/missions/') ? json(mission('UNKNOWN')) : json({ id: id.replace('abc', 'def'), state: 'ended' }));
  assert.equal((await s.handle(req('oathra_phone_result', { id }))).result.isError, true);
});
test('legacy sales tools survive while nested credentials are removed', async () => {
  const s = await initialized(async () => json({ id, status: 'DRAFT', approvalToken: 'private', result: { secret: 'private', note: key } }));
  const result = (await s.handle(req('oathra_draft', { request: '架空の商品を紹介する' }))).result.structuredContent;
  assert.equal(result.id, id); assert.equal(result.approvalToken, undefined);
  assert.equal(result.result.secret, undefined); assert.equal(result.result.note, '[REDACTED]');
});
test('timeouts and response loss do not retry mutations or leak errors', async () => {
  let count = 0; const s = await initialized(async () => { count++; throw new Error('URL bearer=' + key); });
  const result = (await s.handle(req('oathra_phone_draft', phone))).result;
  assert.equal(count, 1); assert.equal(result.isError, true);
  assert.equal(result.content[0].text, 'draft_outcome_unknown_do_not_retry_check_gateway');
  assert.ok(!JSON.stringify(result).includes(key));
});
test('backend rejection is preserved as a safe code without a response body', async () => {
  const s = await initialized(async () => json({ error: 'voice_engine_unavailable', token: key }, 400));
  assert.equal((await s.handle(req('oathra_phone_draft', phone))).result.content[0].text, 'voice_engine_unavailable');
});
test('response size is bounded', async () => {
  const s = createAgentMcp({ baseUrl: 'https://example.test', token: key, maxResponseBytes: 20, fetchImpl: async () => json({ padding: 'x'.repeat(100) }) });
  await s.handle({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  assert.equal((await s.handle(req('oathra_phone_capabilities'))).result.isError, true);
});
test('only HTTPS or explicit loopback origins are accepted', () => {
  for (const url of ['https://example.test', 'http://localhost:4245', 'http://127.0.0.1:9000', 'http://[::1]:4244']) assert.ok(gatewayOrigin(url));
  for (const url of ['http://example.test', 'http://127.0.0.1.evil.test', 'https://u:p@example.test', 'https://example.test/v1', 'https://example.test?key=x', 'https://example.test/#x']) assert.throws(() => gatewayOrigin(url));
});
test('real subprocess stdio -> local HTTP: correct draft endpoint, no dialing, no credential leakage', async t => {
  const calls = []; const http = createServer((req, res) => {
    calls.push(req.url); assert.equal(req.headers.authorization, 'Bearer ' + key);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.url === '/v1/phone/draft' ? { mission: mission(), approvalToken: 'internal-approval' } : { ready: false, engines: [] }));
  });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  t.after(() => { http.closeAllConnections(); http.close(); });
  const child = spawn(process.execPath, [new URL('../mcp.mjs', import.meta.url).pathname], { env: { OATHRA_GATEWAY_URL: `http://127.0.0.1:${http.address().port}`, OATHRA_GATEWAY_TOKEN: key }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  let output = ''; let errors = '';
  child.stdout.on('data', b => output += b); child.stderr.on('data', b => errors += b);
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    req('oathra_phone_draft', phone, 3),
  ];
  child.stdin.end(messages.map(m => JSON.stringify(m)).join('\n') + '\n');
  const code = await new Promise(resolve => child.on('exit', resolve));
  assert.equal(code, 0); assert.equal(errors, '');
  const results = output.trim().split('\n').map(JSON.parse);
  assert.equal(results.length, 3); assert.equal(results[0].result.protocolVersion, '2025-06-18');
  assert.equal(results[2].result.structuredContent.dialed, false);
  assert.deepEqual(calls, ['/v1/phone/draft']);
  assert.ok(!output.includes(key)); assert.ok(!output.includes('internal-approval'));
});
