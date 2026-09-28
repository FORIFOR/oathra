// Practice in the app: the same scenarios and built-in characters as Arena, run on this server with the offline scripted
// agent. Nothing dials, no provider is reached, nothing is charged. The verdict is the evidence engine's, as always.
import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { assert } from './security.mjs';
import { repoUrl } from './paths.mjs';

const scenariosDir = () => fileURLToPath(repoUrl('scenarios/'));
// The practice list in Japanese (the scenario files carry English titles; Arena keeps the same names).
const TITLE_JA = {
  'restaurant-reservation': 'レストラン予約', 'impossible-hotel': '無理難題ホテル', 'bulk-buy': 'まとめ買い交渉', 'serial-number': 'シリアル番号の復唱',
  'false-completion-trap': '満席の罠', 'friend-chat': '友達と雑談', 'friend-hype': '友達とテンション高めの電話', 'restaurant-reservation-intake': 'レストラン予約・追加の聞き取り',
};
const DIFFICULTY = { easy: 'かんたん', medium: 'ふつう', normal: 'ふつう', hard: 'むずかしい' };

// Set by the local app (`oathra demo`): which AIs may make practice calls, and where practice records are kept.
// A plain gateway has only the built-in practice AI and keeps no practice records.
let extraBrains = {}, recordsDir = null;
const BRAIN_LABEL = { openai: 'OpenAI', gemini: 'Gemini', ollama: 'Ollama（このパソコンのAI）' };
export function configurePractice({ brains = {}, records = null } = {}) { extraBrains = Object.fromEntries(Object.entries(brains).filter(([k]) => k !== 'scripted')); recordsDir = records; }
export function practiceBrains() {
  return [{ id: 'scripted', label: '内蔵の練習AI', paid: false },
    ...Object.keys(extraBrains).map(id => ({ id, label: BRAIN_LABEL[id] ?? id, paid: id !== 'ollama' }))];
}
async function brainFor(id = 'scripted') {
  if (!id || id === 'scripted') { const { ScriptedAgent } = await import('../../../providers/simulator/dist/index.js'); return { name: 'scripted', brain: new ScriptedAgent() }; }
  assert(Object.hasOwn(extraBrains, id), 'unknown_practice_brain', 400);
  return { name: id, brain: extraBrains[id]() };
}
async function keep(outcome) {
  if (!recordsDir) return false;
  try { const { saveCall } = await import('../../../packages/replay/dist/index.js'); saveCall(outcome, recordsDir); return true; } catch { return false; }
}

let cache = null;
async function scenarios() {
  if (cache) return cache;
  const { loadScenarioDir } = await import('../../../packages/scenario/dist/index.js');
  // Japanese practice only (the app is Japanese); generic scenarios are real-call templates, not practice.
  cache = loadScenarioDir(scenariosDir()).filter(s => s.domain !== 'generic' && s.language === 'ja');
  return cache;
}
export async function practiceList() {
  return (await scenarios()).map(s => ({ id: s.id, title: TITLE_JA[s.id] ?? s.title, difficulty: DIFFICULTY[s.difficulty] ?? s.difficulty ?? '',
    brief: s.mission?.brief ?? s.description ?? '', callee: s.callee?.persona?.name ?? '', require: Object.keys(s.mission?.require ?? {}) }));
}
/**
 * One entry per settled field, quoting the callee's own words. A value the AI proposed and the callee accepted is
 * verified on the AI's line; the quote then comes from the callee's accepting line (the graph edge), never the AI's.
 */
function settledFrom(result, transcript = []) {
  const nodes = new Map((result.graph?.nodes ?? result.evidence ?? []).map(n => [n.id, n])), edges = result.graph?.edges ?? [];
  const calleeFor = e => {
    if (e.source === 'callee') return e;
    for (const x of edges) if (x.relation !== 'supersedes' && (x.from === e.id || x.to === e.id)) { const o = nodes.get(x.from === e.id ? x.to : x.from); if (o?.source === 'callee') return o; }
    // Accepted without a separate claim of its own: the callee's next line after the proposal is the acceptance.
    const at = transcript.findIndex(t => t.id === e.utteranceId), line = at < 0 ? null : transcript.slice(at + 1).find(t => t.source === 'callee');
    return line ? { utteranceId: line.id, span: acceptedQuote(line.text, e.span), transcript: line.text } : null;
  };
  const out = new Map();
  for (const e of (result.evidence ?? []).filter(e => e.verified)) {
    const said = calleeFor(e); if (!said) continue;
    const entry = { field: e.field, value: e.value, quote: said.span || said.transcript, turnId: said.utteranceId };
    if (!out.has(e.field) || e.source === 'callee') out.set(e.field, entry);
  }
  return [...out.values()];
}
/** The part of the callee's accepting line that repeats the proposal ("9月12日"), else the whole line. */
const acceptedQuote = (line, span) => span && line.includes(span) ? span : line;
/** Run one practice call to the end (fast pace) and return what the app replays: the conversation, and which line settled what. */
export async function practiceRun(id, brainId) {
  const scenario = (await scenarios()).find(s => s.id === id); assert(scenario, 'unknown_practice', 404);
  const [{ runScenario }, { brain, name: brainName }] = await Promise.all([import('../../../packages/eval/dist/index.js'), brainFor(brainId)]);
  const run = await runScenario(scenario, { brain, pace: 'fast' });
  const saved = await keep(run.outcome);
  const { outcome } = run, result = outcome.result;
  // Verified is the evidence engine's word: the callee said it, or accepted the AI's proposal.
  return {
    id: outcome.callId, scenario: { id: scenario.id, title: TITLE_JA[scenario.id] ?? scenario.title, callee: scenario.callee?.persona?.name ?? '' },
    require: Object.keys(scenario.mission?.require ?? {}),
    transcript: outcome.transcript.map(t => ({ id: t.id, source: t.source, text: t.text })),
    // One entry per field the callee's words settled, with the clause that did it and the line it was in.
    settled: settledFrom(result, outcome.transcript),
    status: result.status, complete: result.complete === true, fields: result.fields ?? {},
    falseCompletion: run.score?.falseCompletion === true, saved, brain: brainName,
  };
}

// ---------------------------------------------------------------- 自分が相手役 (play)
// The user answers as the shop, in text, and the offline scripted agent calls them. Same engine and same verdict as a
// watched practice; the conversation is held in memory only (one per user, gone after PLAY_TTL_MS).
const plays = new Map(), PLAY_TTL_MS = 15 * 60_000, MAX_PLAYS = 50;
const newPlayId = () => 'play_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
function sweep(now = Date.now()) { for (const [id, p] of plays) if (now - p.startedAt > PLAY_TTL_MS) { p.cancel(); plays.delete(id); } }
function ownPlay(owner, playId) { sweep(); const p = plays.get(String(playId)); assert(p && p.owner === owner, 'unknown_practice', 404); return p; }

export async function practicePlayStart(owner, id, brainId) {
  sweep();
  const scenario = (await scenarios()).find(s => s.id === id); assert(scenario, 'unknown_practice', 404);
  // One at a time per user: starting again ends the previous one (leaving the page does not always say goodbye).
  for (const p of [...plays.values()].filter(p => p.owner === owner)) { p.cancel(); plays.delete(p.id); }
  assert(plays.size < MAX_PLAYS, 'practice_busy', 503);
  const [{ runScenario }, { HumanCharacter }, { brain }] = await Promise.all([import('../../../packages/eval/dist/index.js'), import('../../../providers/simulator/dist/index.js'), brainFor(brainId)]);
  const human = new HumanCharacter(scenario.callee?.persona?.name ?? '相手', scenario.callee?.greeting);
  const controller = new AbortController(), playId = newPlayId();
  const play = { id: playId, owner, scenario, human, status: 'running', startedAt: Date.now(), turns: [], settled: new Map(), result: null, cancel: () => controller.abort() };
  plays.set(playId, play);
  const heard = [];
  runScenario(scenario, {
    brain, pace: 'fast', callId: playId, signal: controller.signal, character: human, openingTimeoutMs: 6000,
    onEvent: e => {
      if (e.type === 'transcript.final') play.turns.push({ id: e.turnId, source: e.source, text: e.text });
      if (e.type === 'evidence.created' && e.evidence.source === 'callee') heard.push(e.evidence);
      if (e.type === 'evidence.verified' && !play.settled.has(e.evidence.field)) {
        // Verified on the AI's proposal: the callee's line that accepted it is the one just heard (the final graph confirms).
        const turn = e.evidence.source === 'callee' ? null : play.turns.findLast(t => t.source === 'callee');
        const said = e.evidence.source === 'callee' ? e.evidence : heard.findLast(h => h.utteranceId === turn?.id && h.field === e.evidence.field);
        if (said || turn) play.settled.set(e.evidence.field, { field: e.evidence.field, value: e.evidence.value, quote: said ? said.span || said.transcript : acceptedQuote(turn.text, e.evidence.span), turnId: said ? said.utteranceId : turn.id });
      }
    },
  }).then(async run => {
    const result = run.outcome.result; play.status = 'done'; play.saved = await keep(run.outcome);
    play.result = { status: result.status, complete: result.complete === true, fields: result.fields ?? {} };
    // Settled is the evidence engine's final word (it can retract an earlier match); quotes are the callee's words.
    play.settled = new Map(settledFrom(result, run.outcome.transcript).map(x => [x.field, x]));
  }).catch(() => { play.status = 'error'; });
  return practicePlayState(owner, playId);
}
export function practicePlayState(owner, playId) {
  const p = ownPlay(owner, playId);
  return { id: p.id, status: p.status, scenario: { id: p.scenario.id, title: TITLE_JA[p.scenario.id] ?? p.scenario.title, callee: p.scenario.callee?.persona?.name ?? '' },
    require: Object.keys(p.scenario.mission?.require ?? {}), transcript: p.turns, settled: [...p.settled.values()],
    ...(p.result ?? {}), saved: p.saved === true };
}
export function practicePlayReply(owner, playId, text) {
  const p = ownPlay(owner, playId); assert(p.status === 'running', 'practice_ended', 409);
  const said = typeof text === 'string' ? text.trim() : ''; assert(said && said.length <= 500, 'invalid_reply');
  p.human.reply(said); return { ok: true };
}
export function practicePlayHangup(owner, playId) {
  const p = ownPlay(owner, playId); if (p.status === 'running') p.human.hangup(); return { ok: true };
}

// ---------------------------------------------------------------- 記録 (practice records on this computer)
// Calls saved in the records folder: this app's practice runs and `oathra play` in the terminal (.oathra/calls).
const RECORD_ID = /^[A-Za-z0-9_-]{1,80}$/;
export async function practiceRecords() {
  if (!recordsDir) return [];
  const { listCalls, loadCall } = await import('../../../packages/replay/dist/index.js');
  const titles = new Map((await scenarios()).map(s => [s.id, TITLE_JA[s.id] ?? s.title]));
  return listCalls(recordsDir).filter(id => RECORD_ID.test(id)).flatMap(id => {
    try {
      const c = loadCall(id, recordsDir), started = c.events.find(e => e.type === 'call.started');
      const scenario = started?.scenario ?? null;
      return [{ id, scenario, title: (scenario && titles.get(scenario)) ?? c.contract?.target?.name ?? scenario ?? '練習', brain: started?.brain ?? '', complete: c.result?.complete === true, status: c.result?.status ?? '',
        at: statTime(id), durationMs: c.metrics?.durationMs ?? 0 }];
    } catch { return []; }
  }).sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
function statTime(id) { try { return statSync(join(recordsDir, id, 'result.json')).mtime.toISOString(); } catch { return null; } }
export async function practiceRecord(id) {
  assert(recordsDir && RECORD_ID.test(String(id)), 'unknown_practice_record', 404);
  const { loadCall, transcriptFromEvents } = await import('../../../packages/replay/dist/index.js');
  let c; try { c = loadCall(String(id), recordsDir); } catch { assert(false, 'unknown_practice_record', 404); }
  const started = c.events.find(e => e.type === 'call.started'), transcript = transcriptFromEvents(c.events).map(t => ({ id: t.id, source: t.source, text: t.text }));
  const scenario = (await scenarios()).find(s => s.id === started?.scenario);
  return { id: String(id), scenario: { id: started?.scenario ?? null, title: scenario ? TITLE_JA[scenario.id] ?? scenario.title : c.contract?.target?.name ?? '練習', callee: scenario?.callee?.persona?.name ?? c.contract?.target?.name ?? '' },
    brain: started?.brain ?? '', require: Object.keys(c.contract?.require ?? scenario?.mission?.require ?? {}), transcript, settled: settledFrom(c.result ?? {}, transcript),
    status: c.result?.status ?? '', complete: c.result?.complete === true, fields: c.result?.fields ?? {} };
}
