import { defineCall, type CallContract } from '../../packages/contract/src/index.js';
import { EvidenceEngine, evaluate, type Evidence, type VerifiedResult } from '../../packages/evidence/src/index.js';

/** Browser-only, synthetic transcripts. No transport, provider, microphone or persistence. */
export const DEMO_NOTICE = '構想デモ・実際の発信/予約は行いません';
export type DemoKind = 'restaurant' | 'stock' | 'modify';
export type DemoStage = 'input' | 'review' | 'calling' | 'result';
export type DemoScenario = 'normal' | 'unavailable' | 'declined' | 'over-budget' | 'ambiguous' | 'correction';
export type DemoInput = {
  venueId: string;
  date: string;
  time: string;
  partySize: number;
  /** Total meal estimate / product price ceiling; never permission to charge. */
  budget: number;
  model: string;
  pickupDeadline: string;
  name: 'デモ利用者';
};
export type DemoTarget = { id: string; name: string; number: string; area: string; distance: string };
export const VENUES: readonly DemoTarget[] = Object.freeze([
  Object.freeze({ id: 'garden', name: '架空食堂 こもれび', number: 'SIM-001', area: '架空のまち・中央広場', distance: '徒歩 4 分（合成データ）' }),
  Object.freeze({ id: 'harbor', name: '架空ビストロ なぎ', number: 'SIM-002', area: '架空のまち・中央広場', distance: '徒歩 7 分（合成データ）' }),
]);
const SHOP: DemoTarget = Object.freeze({ id: 'stock-shop', name: '架空電器 ミライ', number: 'SIM-003', area: '架空のまち', distance: '合成データ' });
export const MODELS = Object.freeze([
  Object.freeze({ id: 'AZ-1000', name: '架空ヘッドホン AZ-1000', price: 6800 }),
  Object.freeze({ id: 'FZ-2000', name: '架空スピーカー FZ-2000', price: 9800 }),
]);
export const SCENARIOS: readonly { id: DemoScenario; label: string; description: string }[] = Object.freeze([
  { id: 'normal', label: '条件どおり', description: '相手が条件を復唱して明確に確定する' },
  { id: 'unavailable', label: '電話不通', description: '応答がないまま終了する' },
  { id: 'declined', label: '相手が断る', description: '満席・在庫なし・変更不可を伝える' },
  { id: 'over-budget', label: '条件外の料金', description: '予算超過や有料条件を受け入れない' },
  { id: 'ambiguous', label: '曖昧な返答', description: '「たぶん」「確認中」を成功にしない' },
  { id: 'correction', label: '相手が訂正', description: '一度確定と言った後の訂正を反映する' },
]);
export const FLOWS = Object.freeze({
  restaurant: Object.freeze({ id: 'restaurant', title: '近くのお店を予約', subtitle: 'お店を探す → 条件を承認 → 予約結果', description: '合成の近隣候補から選び、予算・日時・人数を確認します。', icon: '01', action: '席の予約', resultLabel: '予約結果' }),
  stock: Object.freeze({ id: 'stock', title: '型番の在庫・取り置き', subtitle: '型番を指定 → 価格と期限を承認 → 取り置き結果', description: '指定した型番だけを、費用・購入義務なしで取り置きします。', icon: '02', action: '無料の取り置き', resultLabel: '取り置き結果' }),
  modify: Object.freeze({ id: 'modify', title: '予約時間を変更', subtitle: '19時の予約 → 20時への変更を承認 → 変更結果', description: '変更できなければ、元の19時の予約を維持します。', icon: '03', action: '19時から20時への変更', resultLabel: '変更結果' }),
});
export const FLOW_LIST = Object.freeze(Object.values(FLOWS));
export const FUTURE_USE_CASES = Object.freeze(['美容室', '自転車修理受付', '営業時間', '忘れ物', 'ホテル遅着', 'クリーニング', '取消']);
export const ORIGINAL_RESERVATION = Object.freeze({ id: 'DEMO-RSV-001', date: '2026-11-20', time: '19:00', partySize: 2 });
export type DemoReservation = { id: string; date: string; time: string; partySize: number };
export type DemoTranscript = { source: 'caller' | 'callee' | 'system'; text: string };
export type DemoApproval = {
  target: DemoTarget;
  input: DemoInput;
  disclosure: string[];
  allowedActions: string[];
  maxCharge: 0;
  purchaseObligation: false;
  fingerprint: string;
};
export type DemoResult = {
  status: 'completed' | 'incomplete' | 'failed' | 'constraint_violation' | 'cancelled';
  title: string;
  detail: string;
  fields: Record<string, unknown>;
  evidence: Evidence[];
  missing: string[];
  originalPreserved?: boolean;
};
export type DemoSnapshot = {
  kind: DemoKind;
  stage: DemoStage;
  input: DemoInput;
  target: DemoTarget;
  scenario: DemoScenario;
  transcript: DemoTranscript[];
  result: DemoResult | null;
  approval: DemoApproval | null;
  /** Local synthetic ledger; never represents a booking at a real venue. */
  reservation: DemoReservation | null;
  step: number;
  totalSteps: number;
  error: string | null;
};

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const kinds: readonly DemoKind[] = ['restaurant', 'stock', 'modify'];
const dateIsValid = (value: string) => {
  if (!/^2026-\d{2}-\d{2}$/.test(value) || value < '2026-10-11' || value > '2026-12-31') return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const dateWords = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
const timeWords = (time: string) => `${Number(time.slice(0, 2))}時${time.slice(3) === '00' ? '' : `${Number(time.slice(3))}分`}`;
const inputKeys = new Set(['venueId', 'date', 'time', 'partySize', 'budget', 'model', 'pickupDeadline', 'name']);

function defaultInput(kind: DemoKind): DemoInput {
  return { venueId: 'garden', date: '2026-11-20', time: kind === 'modify' ? '20:00' : '19:00', partySize: 2, budget: kind === 'stock' ? 10000 : kind === 'modify' ? 0 : 8000, model: 'AZ-1000', pickupDeadline: '18:00', name: 'デモ利用者' };
}

function validate(kind: DemoKind, input: DemoInput): string | null {
  if (input.name !== 'デモ利用者') return '氏名は架空の「デモ利用者」に固定されています。';
  if (!VENUES.some(v => v.id === input.venueId)) return '架空の候補から店舗を選んでください。';
  if (typeof input.date !== 'string' || !dateIsValid(input.date)) return 'デモの日付は2026年10月11日〜12月31日です。';
  if (!Number.isInteger(input.partySize) || input.partySize < 1 || input.partySize > 6) return '人数は1〜6名で指定してください。';
  if (!/^(?:17|18|19|20|21):(?:00|30)$/.test(input.time)) return '予約時刻は17:00〜21:30の30分単位です。';
  if (!/^(?:1[0-9]|20):(?:00|30)$/.test(input.pickupDeadline)) return '受取期限は10:00〜20:30の30分単位です。';
  if (!MODELS.some(m => m.id === input.model)) return '型番は合成データの候補から選んでください。';
  if (kind === 'modify') {
    if (input.time !== '20:00' || input.budget !== 0 || input.date !== ORIGINAL_RESERVATION.date || input.partySize !== ORIGINAL_RESERVATION.partySize || input.venueId !== 'garden') return '変更デモは架空の既存予約を19時から20時へ無料で変更する範囲に限定しています。';
  } else if (!Number.isInteger(input.budget) || input.budget < 2000 || input.budget > 20000) return '予算上限は2,000〜20,000円で指定してください。';
  return null;
}

/** The same contract/evidence code used by the shipped app, with a non-dialable scenario target. */
function contractFor(kind: DemoKind, input: DemoInput, target: DemoTarget): CallContract {
  const time = kind === 'stock' ? input.pickupDeadline : input.time;
  return defineCall({
    goal: kind === 'restaurant' ? 'restaurant.reservation' : kind === 'stock' ? 'retail.free_hold' : 'reservation.modify',
    target: { scenario: `concept-${kind}-${target.id}`, name: target.name },
    input: { ...input, simulation: true, maxCharge: 0, purchaseObligation: false, ...(kind === 'modify' ? { original: ORIGINAL_RESERVATION, preserveOriginalOnFailure: true } : {}) },
    require: { date: true, time: true, confirmed: true, ...(kind === 'stock' ? { serial: true, price: true } : { partySize: true, ...(kind === 'restaurant' ? { price: true } : {}) }) },
    constraints: { date: { eq: input.date }, time: { eq: time }, ...(kind === 'stock' ? { serial: { eq: input.model.replace(/-/g, '') }, price: { lte: input.budget } } : { partySize: { eq: input.partySize }, ...(kind === 'restaurant' ? { price: { lte: input.budget } } : {}) }) },
    permissions: { ask: true, share_name: true, ...(kind === 'modify' ? { modify: true } : { reserve: true }), payment: false, cancel: false, share_address: false, share_phone: false },
    budget: { maxCostUsd: 0, maxTurns: 20, maxDurationMs: 60000 },
    language: 'ja',
  });
}

type SimulationPlan = { turns: DemoTranscript[]; blocked: boolean; quotedPrice: number };

function planFor(kind: DemoKind, input: DemoInput, scenario: DemoScenario): SimulationPlan {
  const turns: DemoTranscript[] = [];
  const add = (source: DemoTranscript['source'], text: string) => turns.push({ source, text });
  const price = kind === 'stock' ? MODELS.find(m => m.id === input.model)!.price : kind === 'restaurant' ? Math.max(2000, input.budget - 1000) : 0;
  const quotedPrice = scenario === 'over-budget' ? (kind === 'modify' ? 1000 : input.budget + 2000) : price;
  const blocked = scenario === 'over-budget' || price > input.budget;
  add('system', `${DEMO_NOTICE}。架空の相手との台本による模擬通話です。`);
  if (scenario === 'unavailable') {
    add('system', '呼出しを模擬しています。実際の回線には接続していません。');
    add('system', '応答がありません。再発信せずに終了します。');
    return { turns, blocked: false, quotedPrice };
  }
  add('caller', 'デモ利用者の代理のAIです。この通話は記録されています。');
  if (kind === 'modify') add('caller', `架空の予約番号 ${ORIGINAL_RESERVATION.id} の変更相談です。変更できない場合は元の19時の予約を維持し、取消しはしないでください。変更料金の支払いは承認されていません。`);
  else if (kind === 'stock') add('caller', '指定した型番だけを確認します。取り置きは無料・購入義務なしに限ります。別の商品への変更や購入・支払いはしません。');
  else add('caller', `食事の合計予算は${input.budget.toLocaleString('ja-JP')}円です。予約手数料・前払い・取消料のある予約は承認されていません。`);
  // Keep the model after the price: adjacent model and price digits separated
  // only by commas can legitimately be interpreted as a spelled serial.
  const terms = `${dateWords(input.date)}${timeWords(kind === 'stock' ? input.pickupDeadline : input.time)}、${kind === 'stock' ? `${quotedPrice}円、型番 ${input.model}` : `${input.partySize}名${kind === 'restaurant' ? `、合計${quotedPrice}円` : ''}`}`;
  if (kind === 'stock') add('caller', `型番 ${input.model} を、${dateWords(input.date)}${timeWords(input.pickupDeadline)}まで取り置きできますか。`);
  else add('caller', `${dateWords(input.date)}${timeWords(input.time)}、${input.partySize}名で${kind === 'modify' ? '変更' : '予約'}できますか。`);
  if (scenario === 'declined') {
    add('callee', kind === 'restaurant' ? '申し訳ありません。満席のため予約できません。' : kind === 'stock' ? '申し訳ありません。その型番の在庫がないため確保できません。' : '20時は満席のため変更できません。元の19時の予約はそのままです。');
    add('caller', '承知しました。この依頼はここで終了します。');
    return { turns, blocked: false, quotedPrice };
  }
  if (blocked) {
    add('callee', kind === 'modify' ? '変更するには手数料1000円が必要です。' : `${terms}になります。`);
    add('caller', '承認された料金条件を超えるため、申し込みません。支払いは行いません。');
    if (kind === 'modify') add('callee', '変更は行わず、元の19時の予約を維持します。');
    return { turns, blocked, quotedPrice };
  }
  add('callee', kind === 'stock' ? '取り置きは無料で、購入義務はありません。' : kind === 'modify' ? '変更手数料は無料です。変更不可の場合は元の予約を維持します。' : '予約手数料・前払い・取消料はありません。');
  add('callee', `${terms}で大丈夫です。`);
  add('caller', `${terms}でお願いします。`);
  if (scenario === 'ambiguous') {
    add('callee', 'たぶん大丈夫だと思いますが、まだ確定ではありません。確認してから折り返します。');
    add('caller', '未確定として持ち帰ります。成立したとはお伝えしません。');
  } else {
    add('callee', kind === 'stock' ? `はい、${terms}で確保しました。` : `はい、${terms}でご予約を承りました。`);
    if (scenario === 'correction') {
      add('callee', kind === 'stock' ? `申し訳ありません、訂正します。型番 ${input.model} は在庫がなく、確保できませんでした。` : kind === 'modify' ? '申し訳ありません、訂正します。20時への変更はできませんでした。元の19時の予約は維持しています。' : '申し訳ありません、訂正します。やはりご予約をお取りできませんでした。');
      add('caller', '訂正を反映し、先ほどの確定を取り消して報告します。');
    } else add('caller', '条件を確認しました。ありがとうございました。');
  }
  return { turns, blocked, quotedPrice };
}

/**
 * Synchronous state machine. All externally exposed objects are copies.
 * Each approval binds the exact target, terms, scenario, disclosure and scope.
 * A real adapter would require separate authorization; this class has no I/O.
 */
export class DemoSession {
  readonly kind: DemoKind;
  private currentStage: DemoStage = 'input';
  private currentInput: DemoInput;
  private currentScenario: DemoScenario = 'normal';
  private currentApproval: DemoApproval | null = null;
  private currentResult: DemoResult | null = null;
  private currentTranscript: DemoTranscript[] = [];
  private currentStep = 0;
  private currentError: string | null = null;
  private plan: SimulationPlan = { turns: [], blocked: false, quotedPrice: 0 };
  private contract: CallContract | null = null;
  private engine: EvidenceEngine | null = null;
  private reservation: DemoReservation | null;

  constructor(kind: DemoKind = 'restaurant') {
    if (!kinds.includes(kind)) throw new Error('Unknown demo flow');
    this.kind = kind;
    this.currentInput = defaultInput(kind);
    this.reservation = kind === 'modify' ? copy(ORIGINAL_RESERVATION) : null;
  }

  get stage(): DemoStage { return this.currentStage; }
  get input(): DemoInput { return copy(this.currentInput); }
  get scenario(): DemoScenario { return this.currentScenario; }
  get target(): DemoTarget { return copy(this.kind === 'stock' ? SHOP : VENUES.find(v => v.id === this.currentInput.venueId)!); }

  private resetRun(): void {
    this.currentApproval = null;
    this.currentResult = null;
    this.currentTranscript = [];
    this.currentStep = 0;
    this.plan = { turns: [], blocked: false, quotedPrice: 0 };
    this.contract = null;
    this.engine = null;
    this.reservation = this.kind === 'modify' ? copy(ORIGINAL_RESERVATION) : null;
    this.currentError = null;
  }

  update(patch: Partial<DemoInput>): boolean {
    if (this.currentStage === 'calling' || this.currentStage === 'result') return false;
    if (!patch || Object.keys(patch).some(key => !inputKeys.has(key))) { this.currentError = 'デモで許可されていない入力です。'; return false; }
    const candidate = { ...this.currentInput, ...patch };
    const error = validate(this.kind, candidate);
    if (error) { this.currentError = error; return false; }
    this.resetRun();
    this.currentInput = candidate;
    this.currentStage = 'input';
    return true;
  }

  setScenario(scenario: DemoScenario): boolean {
    if (this.currentStage === 'calling' || this.currentStage === 'result' || !SCENARIOS.some(s => s.id === scenario)) return false;
    this.resetRun();
    this.currentScenario = scenario;
    this.currentStage = 'input';
    return true;
  }

  review(): boolean {
    if (this.currentStage !== 'input' || this.currentError !== null) return false;
    const error = validate(this.kind, this.currentInput);
    if (error) { this.currentError = error; return false; }
    this.currentError = null;
    this.currentStage = 'review';
    return true;
  }

  private approvalTerms(): Omit<DemoApproval, 'fingerprint'> {
    return { target: this.target, input: this.input, disclosure: this.kind === 'modify' ? ['架空氏名：デモ利用者', `架空予約番号：${ORIGINAL_RESERVATION.id}`] : ['架空氏名：デモ利用者'], allowedActions: this.kind === 'restaurant' ? ['承認日時・人数・予算内での席予約（予約手数料・前払い・取消料なし）'] : this.kind === 'stock' ? ['承認型番・価格上限・期限内の無料取り置き（購入義務なし）'] : ['19時→20時への無料変更。不可なら元の予約を維持。取消不可'], maxCharge: 0, purchaseObligation: false };
  }

  private fingerprint(): string { return JSON.stringify({ kind: this.kind, scenario: this.currentScenario, terms: this.approvalTerms() }); }

  approve(): boolean {
    if (this.currentStage !== 'review' || this.currentError !== null || validate(this.kind, this.currentInput)) return false;
    this.currentApproval = { ...this.approvalTerms(), fingerprint: this.fingerprint() };
    this.contract = contractFor(this.kind, this.currentInput, this.target);
    let id = 0;
    this.engine = new EvidenceEngine({ language: 'ja', now: new Date('2026-10-11T12:00:00Z'), idFactory: () => `demo-evidence-${++id}` });
    this.plan = planFor(this.kind, this.currentInput, this.currentScenario);
    this.currentStage = 'calling';
    return true;
  }

  /** Pass the rendered snapshot.step to make repeated UI events idempotent. */
  next(expectedStep?: number): boolean {
    if (this.currentStage !== 'calling' || !this.currentApproval || !this.engine || !this.contract || (expectedStep !== undefined && expectedStep !== this.currentStep)) return false;
    if (this.currentApproval.fingerprint !== this.fingerprint()) {
      this.resetRun(); this.currentStage = 'input'; this.currentError = '条件が変わったため、もう一度承認してください。'; return false;
    }
    const turn = this.plan.turns[this.currentStep];
    if (turn) {
      this.currentTranscript.push(copy(turn));
      ++this.currentStep;
      if (turn.source !== 'system') this.engine.ingest({ id: `demo-turn-${this.currentStep}`, source: turn.source, text: turn.text, t: this.currentStep * 1000 });
      return true;
    }
    // A disconnected/completed call is not a reservation. Only the production
    // evaluator can make the result complete, and local policy can only veto it.
    const verified = evaluate(this.contract, this.engine, this.currentScenario === 'unavailable' ? 'failed' : 'completed');
    this.currentTranscript.push({ source: 'system', text: '模擬通話が終了しました。相手の発言と承認条件を照合します。' });
    this.currentStep++;
    this.currentResult = this.makeResult(verified);
    if (this.kind === 'modify' && this.currentResult.status === 'completed') {
      this.reservation = { ...ORIGINAL_RESERVATION, time: this.currentInput.time };
    }
    this.currentStage = 'result';
    return true;
  }

  private makeResult(verified: VerifiedResult): DemoResult {
    const status = this.plan.blocked ? 'constraint_violation' : verified.status;
    const complete = status === 'completed';
    let title = complete ? (this.kind === 'stock' ? '無料の取り置きを確認（模擬）' : this.kind === 'modify' ? '20時への変更を確認（模擬）' : '予約の成立を確認（模擬）') : status === 'failed' ? 'つながりませんでした' : status === 'constraint_violation' ? '承認範囲外のため中止' : this.currentScenario === 'correction' ? '訂正を反映：成立していません' : this.currentScenario === 'declined' ? '相手の拒否：成立していません' : '確定を確認できませんでした';
    let detail = complete ? '相手の明確な確定発言と、日時・条件の一致を本番と同じ証跡エンジンで確認しました。実際の発信・予約・購入はありません。' : status === 'failed' ? '応答がなく、確定の証拠はありません。自動で再発信しません。' : status === 'constraint_violation' ? '承認していない料金は受け入れず、申し込み・支払いを行いませんでした。' : this.currentScenario === 'correction' ? '相手の後の訂正により、先に得た確定の証拠を無効にしました。' : this.currentScenario === 'declined' ? '相手の拒否を受け入れて終了しました。別の相手や条件には進みません。' : '通話が終わっても、明確な確定の証拠がそろうまで成功にはしません。';
    if (this.kind === 'stock' && complete) detail += ' 型番・商品価格・受取期限を照合。無料・購入義務なしは、このデモ台本の固定条件です。';
    if (this.kind === 'modify') {
      detail += complete ? ' デモ台帳を20時へ更新しました。' : ' デモ台帳の元の19時の予約は維持しています（取消なし）。';
      if (!complete) title += '・元の予約を維持';
    }
    return { status, title, detail, fields: copy(verified.fields), evidence: copy(verified.evidence), missing: [...verified.missing], ...(this.kind === 'modify' ? { originalPreserved: !complete } : {}) };
  }

  cancel(): boolean {
    if (this.currentStage === 'result') return false;
    this.currentApproval = null;
    this.currentResult = { status: 'cancelled', title: 'デモを取り消しました', detail: this.kind === 'modify' ? '模擬操作を中止しました。デモ台帳の19時の元の予約は維持しています。' : '模擬操作を中止しました。実際の発信・予約・購入はありません。', fields: {}, evidence: [], missing: [], ...(this.kind === 'modify' ? { originalPreserved: true } : {}) };
    this.currentStage = 'result';
    this.currentError = null;
    return true;
  }

  back(): boolean {
    if (this.currentStage === 'input') return false;
    this.resetRun();
    this.currentStage = 'input';
    return true;
  }

  snapshot(): DemoSnapshot {
    return copy({ kind: this.kind, stage: this.currentStage, input: this.currentInput, target: this.target, scenario: this.currentScenario, transcript: this.currentTranscript, result: this.currentResult, approval: this.currentApproval, reservation: this.reservation, step: this.currentStep, totalSteps: this.plan.turns.length + 1, error: this.currentError });
  }
}
