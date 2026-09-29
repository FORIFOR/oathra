// Both ends of a booking call, with the product on the receiving end.
//
//   the side that books     ScriptedAgent; the verdict comes from evaluate(), as on every call
//   the side that is booked the product's reception: its instructions, its two desk tools, the read-back gate
//                           and the ledger from @oathra/core. A language model speaks the words (text, no audio).
//
// Each situation is a call to the same restaurant, ビストロ灯. Afterwards the caller's verdict and the ledger are
// compared: a booking counts only when both hold it, and a call that must not book leaves the ledger as it was.
// Uses the OpenAI API (a few cents for the whole run); nothing is dialled.
//   node --env-file=.env scripts/reception-sim.mjs [--model gpt-4o-mini] [--show] [--only <id>] [--hasty]
// --hasty tells the model to skip the read-back and book at once: the deterministic gate has to stop it.
import { resolve } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
const at = (p) => import(resolve(p));
const [{ defineScenario }, { ScriptedAgent }, { runScenario }, core, { defineRestaurantReception }, live] = await Promise.all([
  at("packages/scenario/dist/index.js"), at("providers/simulator/dist/index.js"), at("packages/eval/dist/index.js"), at("packages/core/dist/index.js"), at("packages/contract/dist/index.js"), at("providers/openai-realtime/dist/index.js")]);

const key = process.env.OPENAI_API_KEY;
if (!key) { console.error("BLOCKED: OPENAI_API_KEY is required"); process.exit(2); }
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const model = arg("--model") ?? "gpt-4o-mini", show = process.argv.includes("--show"), hasty = process.argv.includes("--hasty"), only = arg("--only");
const NOW = new Date("2026-09-21T10:00:00+09:00"), DATE = "2026-09-25";
const TABLES = { "18:00": 2, "18:30": 1, "19:00": 0, "19:30": 1, "20:00": 2, "20:30": 1 };

/** The product's reception, speaking text instead of audio. Tools, gate and ledger are the shipped code. */
class ProductReception {
  constructor(config, ledger, callId) {
    this.config = config; this.ledger = ledger; this.callId = callId; this.said = []; this.toolLog = [];
    this.contract = defineRestaurantReception({ restaurantName: config.name, callerPhone: "+819000000000", today: core.tokyoDate(NOW.getTime()), seatings: Object.keys(config.slots).sort(), maxParty: config.maxParty, ...(config.closedDates?.length ? { closedNote: config.closedDates.join("、") } : {}) });
    this.name = config.name;
    this.messages = [{ role: "system", content: live.restaurantReceptionInstructions(this.contract) + "\nこれは文字のやり取りです。話す言葉だけを返してください。電話を終えるときは最後の挨拶だけを返してください。" + (hasty ? "\n【試験用の上書き】復唱は省略し、日付・時刻・人数・名前が分かったらすぐに book_table を呼んでください。" : "") }];
    this.desk = {
      check: (r) => core.checkTable(config, ledger.bookings, r, NOW.getTime(), callId),
      book: (r) => { const out = core.bookTable(config, ledger.bookings, { ...r, callId, id: `b-${callId}` }, NOW.getTime()); ledger.bookings = out.bookings; return out.answer; },
    };
  }
  greeting() { const text = live.receptionGreeting(this.contract); this.said.push(text); this.messages.push({ role: "assistant", content: text }); return text; }
  async respond(ctx) {
    this.messages.push({ role: "user", content: ctx.lastAgentText });
    for (let step = 0; step < 6; step++) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(45000),
        body: JSON.stringify({ model, temperature: 0.3, messages: this.messages, tools: live.DESK_TOOLS.map(({ type, ...fn }) => ({ type, function: fn })) }) });
      if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const message = (await res.json()).choices[0].message;
      this.messages.push(message);
      if (!message.tool_calls?.length) { const text = String(message.content ?? "").trim(); this.said.push(text); return { text, hangup: /失礼いたします|失礼します/.test(text) && !/[?？]/.test(text) }; }
      // A model that speaks and calls a tool in one step has said those words aloud.
      if (message.content) this.said.push(String(message.content));
      for (const call of message.tool_calls) {
        let args = {}; try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* refused below */ }
        const result = await live.deskTool(this.desk, call.function.name, args, this.said, NOW, "ja");
        this.toolLog.push(`${call.function.name}(${JSON.stringify(args)}) -> ${JSON.stringify(result)}`);
        this.messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
    return { text: "恐れ入ります、ただいま予約を記録できません。あらためてお電話ください。失礼いたします。", hangup: true };
  }
  truth() { const b = this.ledger.bookings.find((x) => x.callId === this.callId); return b ? { confirmed: true, date: b.date, time: b.time, partySize: b.partySize, name: b.name } : { confirmed: false }; }
}

function scenario(s) {
  const date = s.date ?? DATE, partySize = s.partySize ?? 2;
  return defineScenario({ version: 1, id: `reception-${s.id}`, title: s.id, description: s.id, difficulty: "easy", language: "ja", domain: "restaurant", tags: ["reservation", "two-sided"],
    mission: { objective: "restaurant.reservation", brief: `${date}に${partySize}名の予約を取ってください。`, input: { date, partySize, name: s.name ?? "田中" }, require: { date: true, time: true, partySize: true, confirmed: true },
      constraints: { date: { eq: date }, time: s.time ?? { gte: "19:00" }, partySize: { eq: partySize } }, permissions: { ask: true, reserve: true, share_name: s.shareName ?? true, cancel: false, payment: false } },
    callee: { persona: { name: "ビストロ灯", patience: 0.7, flexibility: 0.5, friendliness: 0.8, avatar: "^_^" }, knowledge: { now: NOW.toISOString() }, rules: [] },
    win: { confirmed: true }, score: { success: 5000, latency: 0.1, turns: 0.1 } });
}

// expect: the time both ends must hold ("any": whichever free table from 19:00 on they settle on), or null when nobody may hold a booking.
const SITUATIONS = [
  { id: "free", time: { eq: "20:00" }, expect: "20:00" },
  { id: "alternative", expect: "19:30" },
  { id: "only-earlier", tables: { "18:00": 2, "19:00": 0, "19:30": 0, "20:00": 0 }, expect: null },
  { id: "full", tables: { "18:00": 0, "19:00": 0, "19:30": 0, "20:00": 0 }, expect: null },
  { id: "closed", date: "2026-09-23", expect: null },
  { id: "too-many", partySize: 10, expect: null },
  { id: "no-name", shareName: false, expect: null },
  { id: "last-table-1", group: "last", name: "田中", expect: "19:30" },
  { id: "last-table-2", group: "last", name: "佐藤", expect: "20:00" },
  { id: "fills-1", group: "fills", tables: { "19:00": 1, "19:30": 1 }, name: "田中", expect: "any" },
  { id: "fills-2", group: "fills", tables: { "19:00": 1, "19:30": 1 }, name: "佐藤", expect: "any" },
  { id: "fills-3", group: "fills", tables: { "19:00": 1, "19:30": 1 }, name: "鈴木", expect: null },
].filter((s) => !only || s.id.startsWith(only));

const ledgers = new Map(), rows = [], log = [];
for (const s of SITUATIONS) {
  const config = core.parseDeskConfig({ name: "ビストロ灯", slots: s.tables ?? TABLES, maxParty: 6, closedDates: ["2026-09-23"] });
  const ledger = s.group ? (ledgers.get(s.group) ?? ledgers.set(s.group, { bookings: [] }).get(s.group)) : { bookings: [] };
  const before = ledger.bookings.length, desk = new ProductReception(config, ledger, `call-${s.id}`);
  const run = await runScenario(scenario(s), { brain: new ScriptedAgent(), character: desk, seed: 1 });
  const mine = ledger.bookings.find((b) => b.callId === `call-${s.id}`), r = run.outcome.result;
  const overbooked = Object.keys(config.slots).some((t) => ledger.bookings.filter((b) => b.date === (s.date ?? DATE) && b.time === t).length > config.slots[t]);
  const agree = s.expect
    ? !!mine && (s.expect === "any" ? mine.time >= "19:00" : mine.time === s.expect) && r.complete && r.fields.time === mine.time && r.fields.date === mine.date && r.fields.partySize === mine.partySize && ledger.bookings.length === before + 1
    : !mine && !r.complete && r.fields.confirmed !== true && ledger.bookings.length === before;
  const ok = agree && !run.score.falseCompletion && !overbooked;
  rows.push({ situation: s.id, caller: r.complete ? `completed ${r.fields.time}` : r.status, ledger: mine ? `${mine.time} ${mine.partySize}名 ${mine.name}` : "-", expected: s.expect ?? "no booking", falseCompletion: run.score.falseCompletion, result: ok ? "PASS" : "FAIL" });
  const transcript = run.outcome.transcript.map((t) => `  ${t.source === "callee" ? "店AI" : "客AI"}: ${t.text}`).join("\n");
  log.push(`── ${s.id}: ${ok ? "PASS" : "FAIL"} | caller ${r.status} ${JSON.stringify(r.fields)} | ledger ${JSON.stringify(mine ?? null)}\n${transcript}\n  tools:\n${desk.toolLog.map((l) => "    " + l).join("\n")}`);
  if (show || !ok) console.log(log.at(-1));
}
console.table(rows);
console.log(`read-back gate refusals: ${log.join("\n").split("read_back_required").length - 1}`);
const out = resolve(process.env.SIM_OUT ?? "artifacts/quality/reception-sim"); mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, "transcripts.txt"), `model=${model}\n\n` + log.join("\n\n") + "\n");
const failed = rows.filter((r) => r.result !== "PASS").length;
console.log(`${rows.length - failed} / ${rows.length} situations agree on both ends · False Completion ${rows.filter((r) => r.falseCompletion).length} · transcripts -> ${out}/transcripts.txt`);
process.exit(failed ? 1 : 0);
