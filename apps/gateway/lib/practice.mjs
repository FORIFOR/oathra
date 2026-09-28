// Practice in the app: the same scenarios and built-in characters as Arena, run on this server with the offline scripted
// agent. Nothing dials, no provider is reached, nothing is charged. The verdict is the evidence engine's, as always.
import { fileURLToPath } from 'node:url';
import { assert } from './security.mjs';

const SCENARIOS_DIR = fileURLToPath(new URL('../../../scenarios/', import.meta.url));
// The practice list in Japanese (the scenario files carry English titles; Arena keeps the same names).
const TITLE_JA = {
  'restaurant-reservation': 'レストラン予約', 'impossible-hotel': '無理難題ホテル', 'bulk-buy': 'まとめ買い交渉', 'serial-number': 'シリアル番号の復唱',
  'false-completion-trap': '満席の罠', 'friend-chat': '友達と雑談', 'friend-hype': '友達とテンション高めの電話', 'restaurant-reservation-intake': 'レストラン予約・追加の聞き取り',
};
const DIFFICULTY = { easy: 'かんたん', medium: 'ふつう', hard: 'むずかしい' };

let cache = null;
async function scenarios() {
  if (cache) return cache;
  const { loadScenarioDir } = await import('../../../packages/scenario/dist/index.js');
  // Japanese practice only (the app is Japanese); generic scenarios are real-call templates, not practice.
  cache = loadScenarioDir(SCENARIOS_DIR).filter(s => s.domain !== 'generic' && s.language === 'ja');
  return cache;
}
export async function practiceList() {
  return (await scenarios()).map(s => ({ id: s.id, title: TITLE_JA[s.id] ?? s.title, difficulty: DIFFICULTY[s.difficulty] ?? s.difficulty ?? '',
    brief: s.mission?.brief ?? s.description ?? '', callee: s.callee?.persona?.name ?? '', require: Object.keys(s.mission?.require ?? {}) }));
}
/** Run one practice call to the end (fast pace) and return what the app replays: the conversation, and which line settled what. */
export async function practiceRun(id) {
  const scenario = (await scenarios()).find(s => s.id === id); assert(scenario, 'unknown_practice', 404);
  const [{ runScenario }, { ScriptedAgent }] = await Promise.all([import('../../../packages/eval/dist/index.js'), import('../../../providers/simulator/dist/index.js')]);
  const run = await runScenario(scenario, { brain: new ScriptedAgent(), pace: 'fast' });
  const { outcome } = run, result = outcome.result;
  // Verified is the evidence engine's word: the callee said it, or accepted the AI's proposal.
  const settled = (result.evidence ?? []).filter(e => e.verified);
  return {
    id: outcome.callId, scenario: { id: scenario.id, title: TITLE_JA[scenario.id] ?? scenario.title, callee: scenario.callee?.persona?.name ?? '' },
    require: Object.keys(scenario.mission?.require ?? {}),
    transcript: outcome.transcript.map(t => ({ id: t.id, source: t.source, text: t.text })),
    // One entry per field the callee's words settled, with the clause that did it and the line it was in.
    settled: [...new Map(settled.map(e => [e.field, { field: e.field, value: e.value, quote: e.span || e.transcript, turnId: e.utteranceId }])).values()],
    status: result.status, complete: result.complete === true, fields: result.fields ?? {},
    falseCompletion: run.score?.falseCompletion === true,
  };
}
