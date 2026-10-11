// A bounded, synthetic-only operations rehearsal. This is not a phone runtime,
// transcript extractor, customer confirmation, or a production intake endpoint.
import { randomUUID } from 'node:crypto';
import { assert } from './security.mjs';

export const INTAKE_KIND = 'intake-pilot';
export const INTAKE_FIELDS = Object.freeze({ region: '工事の地域', contact: '折り返し先', callbackPreference: '折り返し希望', message: '相談内容' });
export const INTAKE_ASSIGNEES = Object.freeze({ demo_a: 'デモ担当 A', demo_b: 'デモ担当 B' });
export const INTAKE_OUTCOMES = Object.freeze({ handed_over: '折り返して見積相談を引き継いだ（練習）', withdrawn: '折り返して相談の取り下げを確認した（練習）' });

const turn = (id, source, text) => ({ id, source, text });
const proposals = [
  { field: 'region', value: 'デモ市の北エリア', turnId: 'customer-1' },
  { field: 'contact', value: 'デモ折り返し先 A', turnId: 'customer-2' },
  { field: 'callbackPreference', value: '平日の午後', turnId: 'customer-2' },
  { field: 'message', value: '洗面台の交換について見積もりを相談したい', turnId: 'customer-1' },
];
const opening = turn('assistant-1', 'assistant', '受付の練習です。相談内容と折り返しの希望を教えてください。');
const request = turn('customer-1', 'customer', 'デモ市の北エリアです。洗面台の交換について見積もりを相談したいです。');
const answer = turn('customer-2', 'customer', 'デモ折り返し先 A に、平日の午後に連絡してほしいです。');
const fixtures = [
  { id: 'complete', title: '洗面台交換の見積相談', description: '4項目の回答あり。人が確認して折り返しの練習へ', transcript: [opening, request, answer, turn('assistant-2', 'assistant', '担当者に引き継ぎます。見積金額や訪問日時はまだ決まっていません。')], proposals },
  { id: 'missing', title: '折り返し先が聞き取れなかった例', description: '聞き取れない情報を埋めず、要確認のまま残す', transcript: [opening, request, turn('customer-2', 'customer', '平日の午後が希望です。折り返し先は……'), turn('assistant-2', 'assistant', 'すべて確認できました。')], proposals },
  { id: 'unknown', title: '話者が不明な回答の例', description: '不明な話者やAIの発言を、お客さまの回答にしない', transcript: [opening, request, turn('customer-2', 'unknown', answer.text), turn('assistant-2', 'assistant', 'デモ折り返し先 A、平日の午後ですね。受付は完了しました。')], proposals },
];

// Proposals are curated fixture data, not model output. Even here they must point
// to a unique customer turn and a verbatim span; assistant/unknown never count.
export function candidateFields(transcript, suggested) {
  return Object.fromEntries(Object.keys(INTAKE_FIELDS).map(field => {
    const candidates = suggested.filter(p => p.field === field);
    const p = candidates.length === 1 ? candidates[0] : null;
    const evidence = p ? transcript.filter(t => t.id === p.turnId) : [];
    const valid = evidence.length === 1 && evidence[0].source === 'customer' && typeof p.value === 'string' && p.value.length > 0 && evidence[0].text.includes(p.value);
    return [field, valid ? { value: p.value, turnId: p.turnId, quote: evidence[0].text } : { value: null, turnId: null, quote: null }];
  }));
}

export class IntakePilot {
  constructor(service) { this.service = service; this.store = service.store; }
  enabled() { assert(this.service.config.mode === 'simulator', 'intake_pilot_simulator_only', 409); }
  list(u) {
    this.enabled();
    return { synthetic: true, fixtures: fixtures.map(({ id, title, description }) => ({ id, title, description })), fields: INTAKE_FIELDS, assignees: INTAKE_ASSIGNEES, outcomes: INTAKE_OUTCOMES, cases: this.store.list(INTAKE_KIND, u.id) };
  }
  create(u, data) {
    this.enabled(); this.service.write(u);
    assert(data.synthetic === true && Object.keys(data).every(k => ['fixtureId', 'synthetic'].includes(k)), 'intake_synthetic_fixture_required');
    const fixture = fixtures.find(f => f.id === data.fixtureId);
    assert(fixture, 'intake_synthetic_fixture_required');
    return this.store.tx(() => {
      // At most one case per fixture per owner. Retrying a lost response cannot
      // create duplicate work. The route accepts no transcript or personal data.
      const saved = this.store.all(INTAKE_KIND, u.id).find(c => c.fixtureId === fixture.id);
      if (saved) return saved;
      const now = this.store.now();
      const c = { id: randomUUID(), owner: u.id, team: u.team, synthetic: true, fixtureId: fixture.id, title: fixture.title,
        revision: 1, status: 'unhandled', reviewState: 'needs_review', fields: candidateFields(fixture.transcript, fixture.proposals),
        transcript: structuredClone(fixture.transcript), assignee: null, dueAt: null, resolution: null, createdAt: now, updatedAt: now,
        history: [{ action: 'created', actor: u.id, at: now, revision: 1 }] };
      this.store.put(INTAKE_KIND, c); this.store.audit(u.id, 'intake_pilot.created', c.id); return c;
    });
  }
  change(u, id, data) {
    this.enabled(); this.service.write(u);
    assert(Object.keys(data).every(k => ['revision', 'action', 'acknowledged', 'assignee', 'dueAt', 'outcome'].includes(k)), 'intake_invalid_action');
    return this.store.tx(() => {
      const c = this.service.own(INTAKE_KIND, id, u);
      assert(c.synthetic === true, 'intake_synthetic_fixture_required');
      assert(Number.isSafeInteger(data.revision) && data.revision === c.revision, 'intake_changed_reload', 409);
      assert(data.acknowledged === true, 'intake_explicit_action_required');
      const now = this.store.now();
      if (data.action === 'assign') {
        assert(c.status !== 'done', 'intake_reopen_first', 409);
        assert(typeof data.assignee === 'string' && Object.hasOwn(INTAKE_ASSIGNEES, data.assignee), 'intake_assignee_required');
        assert(Number.isSafeInteger(data.dueAt) && data.dueAt > now && data.dueAt <= now + 30 * 86400_000, 'intake_future_due_required');
        c.assignee = data.assignee; c.dueAt = data.dueAt;
      } else if (data.action === 'confirm') {
        assert(c.status === 'unhandled' && c.reviewState === 'needs_review', 'intake_invalid_transition', 409);
        assert(Object.values(c.fields).every(f => f.value !== null), 'intake_missing_customer_evidence', 409);
        c.reviewState = 'confirmed'; c.reviewedBy = u.id; c.reviewedAt = now;
      } else if (data.action === 'queue') {
        assert(c.status === 'unhandled' && c.reviewState === 'confirmed', 'intake_review_required', 409);
        assert(c.assignee && c.dueAt, 'intake_assignment_required', 409);
        c.status = 'callback_pending';
      } else if (data.action === 'done') {
        assert(c.status === 'callback_pending' && c.reviewState === 'confirmed', 'intake_callback_required', 409);
        assert(typeof data.outcome === 'string' && Object.hasOwn(INTAKE_OUTCOMES, data.outcome), 'intake_resolution_required');
        c.status = 'done'; c.resolution = { outcome: data.outcome, actor: u.id, at: now, source: 'human_demo_report', externallyVerified: false };
      } else if (data.action === 'reopen') {
        assert(['callback_pending', 'done'].includes(c.status), 'intake_invalid_transition', 409);
        c.status = 'unhandled'; c.reviewState = 'needs_review'; c.resolution = null; delete c.reviewedBy; delete c.reviewedAt;
      } else assert(false, 'intake_invalid_action');
      c.revision++; c.updatedAt = now;
      c.history.push({ action: data.action, actor: u.id, at: now, revision: c.revision,
        ...(data.action === 'assign' ? { assignee: c.assignee, dueAt: c.dueAt } : {}), ...(data.action === 'done' ? { outcome: data.outcome } : {}) });
      this.store.put(INTAKE_KIND, c); this.store.audit(u.id, `intake_pilot.${data.action}`, c.id); return c;
    });
  }
}
