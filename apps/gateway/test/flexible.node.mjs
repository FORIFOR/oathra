// Calling from a prompt: what the person asked us to remember goes with each call, the target comes from the words,
// people called are remembered, presets are the person's own, and a sales call needs no product (2026-10-04).
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Store } from '../lib/store.mjs';
import { Service } from '../lib/service.mjs';
import { prepareManagedPhone, resolvePhoneTarget } from '../lib/phone-service.mjs';
import { hash } from '../lib/security.mjs';
function fixture(mode = 'live') {
  const config = { mode, liveReady: mode === 'live', users: [{ id: 'alice', team: 'one', role: 'admin', tokenHash: hash('a') }, { id: 'bob', team: 'one', role: 'admin', tokenHash: hash('b') }], maxSeconds: 300, maxCallUsd: 10, dailyCalls: 20, dailyUsd: 30, rateCeilingUsd: 0.1, setupFeeUsd: 0, consentVersion: 'v1', publicUrl: 'https://gateway.example.org', missing: [], callerId: '+15550000000' };
  const store = new Store(':memory:', randomBytes(32).toString('hex')), service = new Service(store, config);
  const [u, bob] = config.users; service.saveConsent(u, 'v1');
  return { store, service, u, bob, close() { store.close(); } };
}
const using = (fn, mode) => async () => { const f = fixture(mode); try { await fn(f); } finally { f.close(); } };
const code = fn => { try { fn(); } catch (e) { return e.code ?? e.message; } return null; };

test('what the person asked us to remember goes with every request, and an explicit value wins', using(f => {
  f.service.saveCallerName(f.u, '堀尾'); f.service.saveProfile(f.u, '株式会社リングゼロ 営業部。折り返しは 03-1234-5678。');
  const m = prepareManagedPhone(f.service, f.u, { phone: '09012345678', name: '田中', instruction: '明日の打ち合わせの時間を確認してください。' });
  assert.equal(m.phoneRequest.callerName, '堀尾'); assert.equal(m.phoneRequest.callerProfile, '株式会社リングゼロ 営業部。折り返しは 03-1234-5678。');
  const own = prepareManagedPhone(f.service, f.u, { phone: '09012345678', name: '田中', instruction: '確認してください。', callerProfile: '別の会社' });
  assert.equal(own.phoneRequest.callerProfile, '別の会社');
  f.service.saveProfile(f.u, ''); assert.equal(f.service.account(f.u).profile, null, 'an empty profile forgets it');
  assert.equal(code(() => f.service.saveProfile(f.u, 'x'.repeat(2001))), 'profile_too_long');
}));

test('the target comes from the words: a number, or the one contact named; never a guess', using(f => {
  f.service.contact(f.u, { name: '田中', phone: '+819011112222' }); f.service.contact(f.u, { name: '田中商事', company: '田中商事', phone: '+81311112222' }); f.service.contact(f.u, { name: '佐藤', phone: '+819033334444' });
  assert.deepEqual(resolvePhoneTarget(f.service, f.u, '佐藤さんに明日の予定を聞いて'), { phone: '+819033334444', name: '佐藤' });
  assert.deepEqual(resolvePhoneTarget(f.service, f.u, '田中商事に納期を確認して'), { phone: '+81311112222', name: '田中商事' }, 'the longer name that contains the shorter wins');
  assert.equal(resolvePhoneTarget(f.service, f.u, '090-5555-6666 に電話して、在庫を聞いて').phone, '+819055556666');
  assert.equal(code(() => resolvePhoneTarget(f.service, f.u, '取引先に電話して')), 'phone_target_not_found');
  f.service.contact(f.u, { name: '鈴木', phone: '+819077778888' });
  assert.equal(code(() => resolvePhoneTarget(f.service, f.u, '佐藤さんと鈴木さんに電話して')), 'select_one_contact');
  const m = prepareManagedPhone(f.service, f.u, { instruction: '佐藤さんに、来週の打ち合わせの候補を聞いてください。' });
  assert.equal(m.target.phone, '+819033334444'); assert.equal(m.target.name, '佐藤');
  assert.equal(code(() => resolvePhoneTarget(f.service, f.bob, '佐藤さんに電話して')), 'phone_target_not_found', 'another person’s contacts are never used');
}));

test('a number called on an approved request is remembered as a contact, once', using(f => {
  assert.ok(f.service.rememberContact(f.u, { name: '山田', phone: '+819012340000' }));
  assert.equal(f.service.rememberContact(f.u, { name: '山田さん', phone: '+819012340000' }), null, 'the same number is not saved twice');
  assert.equal(f.service.rememberContact(f.u, { name: '', phone: '+819012340001' }), null, 'a number without a name is not saved');
  const saved = f.store.list('contact', f.u.id).filter(c => c.phone === '+819012340000');
  assert.equal(saved.length, 1); assert.equal(saved[0].relationship, '', 'no relationship or consent is invented');
}));

test('presets are the person’s own: saved, renamed, listed newest first, deleted; never another person’s', using(f => {
  const a = f.service.savePreset(f.u, { title: '納期の確認', instruction: '{{品名}}の納期を確認してください。'.replace('{{品名}}', 'ネジ') });
  const b = f.service.savePreset(f.u, { title: '見守り', instruction: 'お変わりないか聞いてください。', pace: 'gentle', conversationMode: 'bogus' });
  assert.equal(b.pace, 'gentle'); assert.equal(b.conversationMode, undefined, 'only known options are kept');
  f.service.savePreset(f.u, { id: a.id, title: '納期の確認（部品）', instruction: a.instruction });
  assert.deepEqual(f.service.presets(f.u).map(p => p.title), ['納期の確認（部品）', '見守り']);
  assert.equal(f.service.presets(f.bob).length, 0); assert.equal(code(() => f.service.removePreset(f.bob, a.id)), 'not_found');
  assert.equal(code(() => f.service.savePreset(f.u, { title: '', instruction: 'x' })), 'preset_title_required');
  f.service.removePreset(f.u, a.id); assert.deepEqual(f.service.presets(f.u).map(p => p.title), ['見守り']);
}));

test('a sales call needs no product and no saved contact; what the person asked to remember goes with it', using(f => {
  f.service.saveProfile(f.u, '株式会社リングゼロ。業務用の電話代行サービス。');
  const m = f.service.prepare(f.u, { request: '新しい電話代行サービスのご案内をして、資料を送ってよいか聞いてください。', phone: '0312349999', name: '山田商店' });
  assert.equal(m.product, null); assert.equal(m.target.name, '山田商店'); assert.equal(m.goal, 'materials'); assert.equal(m.callerProfile, '株式会社リングゼロ。業務用の電話代行サービス。');
  assert.ok(f.service.review(f.u, m.id).approvalToken);
  f.store.suppress('one', '+81312349999', 'verbal');
  const again = f.service.prepare(f.u, { request: 'もう一度ご案内', phone: '0312349999', name: '山田商店' });
  assert.equal(code(() => f.service.checkPolicy(f.u, again)), 'recipient_suppressed', 'who asked not to be called is still never called');
}));
