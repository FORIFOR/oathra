/**
 * One concrete restaurant, several situations, both ends of the same call checked at once.
 *
 *   the side that books    the caller's verdict, from `evaluate()` over the transcript
 *   the side that is booked the restaurant's own ledger (`ReservationBook`): what it actually wrote down
 *
 * The two never see each other's state; they only talk. A booking counts only when both agree, and a call
 * that must not end in a booking must leave the ledger empty and the verdict incomplete.
 */
import { describe, expect, it } from "vitest";
import { defineScenario, type Scenario } from "@oathra/scenario";
import { RestaurantCharacter, ReservationBook, ScriptedAgent } from "@oathra/simulator";
import { runScenario, type ScenarioRun } from "./index.js";

/** ビストロ灯: 6 seatings an evening, parties up to 6, closed on 2026-09-23, takes bookings by name only. */
const TABLES = { "18:00": 2, "18:30": 1, "19:00": 0, "19:30": 1, "20:00": 2, "20:30": 1 };
const DATE = "2026-09-25";

type Situation = { id: string; date?: string; partySize?: number; name?: string; time?: Record<string, string>; tables?: Record<string, number>; shareName?: boolean };

function situation(s: Situation): Scenario {
  const date = s.date ?? DATE, partySize = s.partySize ?? 2, time = s.time ?? { gte: "19:00" };
  return defineScenario({
    version: 1, id: `bistro-akari-${s.id}`, title: `ビストロ灯 ${s.id}`, description: s.id, difficulty: "easy", language: "ja", domain: "restaurant", tags: ["reservation", "two-sided"],
    mission: {
      objective: "restaurant.reservation", brief: `${date}に${partySize}名の予約を取ってください。`,
      input: { date, partySize, name: s.name ?? "田中" },
      require: { date: true, time: true, partySize: true, confirmed: true },
      constraints: { date: { eq: date }, time, partySize: { eq: partySize } },
      permissions: { ask: true, reserve: true, share_name: s.shareName ?? true, cancel: false, payment: false },
    },
    callee: {
      persona: { name: "ビストロ灯", patience: 0.7, flexibility: 0.5, friendliness: 0.8, avatar: "^_^" },
      knowledge: { now: "2026-09-21T10:00:00+09:00", availability: s.tables ?? TABLES, closed_dates: ["2026-09-23"], max_party: 6, require_name: true },
      rules: ["never confirm a reservation without a name"],
    },
    win: { confirmed: true }, score: { success: 5000, latency: 0.1, turns: 0.1 },
  } as Parameters<typeof defineScenario>[0]);
}

async function call(s: Situation, book = new ReservationBook(s.tables ?? TABLES)): Promise<{ run: ScenarioRun; book: ReservationBook }> {
  const scenario = situation(s);
  const run = await runScenario(scenario, { brain: new ScriptedAgent(), character: new RestaurantCharacter(scenario, book), seed: 1 });
  if (process.env.OATHRA_SHOW_CALLS) console.log(`\n── ${s.id}: ${run.outcome.result.status} ${JSON.stringify(run.outcome.result.fields)} | ledger ${JSON.stringify(book.bookings)}\n` + run.outcome.transcript.map((t) => `  ${t.source === "callee" ? "店" : "AI"}: ${t.text}`).join("\n"));
  return { run, book };
}

/** Both ends hold the same booking. */
function bookedOnBothSides({ run, book }: { run: ScenarioRun; book: ReservationBook }, expected: { date: string; time: string; partySize: number; name: string }) {
  expect(book.bookings).toEqual([expected]);
  // What the receptionist believes it promised is what the ledger holds.
  expect(run.truth).toMatchObject({ confirmed: true, date: expected.date, time: expected.time, partySize: expected.partySize });
  expect(run.outcome.result.complete).toBe(true);
  expect(run.outcome.result.fields).toMatchObject({ date: expected.date, time: expected.time, partySize: expected.partySize, confirmed: true });
  expect(run.score.falseCompletion).toBe(false);
}

/** Neither end holds a booking. */
function bookedOnNeitherSide({ run, book }: { run: ScenarioRun; book: ReservationBook }) {
  expect(book.bookings).toEqual([]);
  expect(run.outcome.result.complete).toBe(false);
  expect(run.outcome.result.fields.confirmed).not.toBe(true);
}

describe("ビストロ灯: the caller's verdict and the restaurant's ledger, call by call", () => {
  it("the wanted time is free: booked, and both ends hold the same booking", async () => {
    bookedOnBothSides(await call({ id: "free", time: { eq: "20:00" } }), { date: DATE, time: "20:00", partySize: 2, name: "田中" });
  });

  it("19:00 is full, 19:30 is offered and is within what the caller may accept: booked at 19:30 on both ends", async () => {
    bookedOnBothSides(await call({ id: "alternative" }), { date: DATE, time: "19:30", partySize: 2, name: "田中" });
  });

  it("everything from 19:00 on is full and only an earlier table is offered: nobody books anything", async () => {
    bookedOnNeitherSide(await call({ id: "only-earlier", tables: { "18:00": 2, "19:00": 0, "19:30": 0, "20:00": 0 } }));
  });

  it("the whole evening is full: nobody books anything", async () => {
    bookedOnNeitherSide(await call({ id: "full", tables: { "18:00": 0, "19:00": 0, "19:30": 0, "20:00": 0 } }));
  });

  it("the restaurant is closed that day: nobody books anything", async () => {
    bookedOnNeitherSide(await call({ id: "closed", date: "2026-09-23" }));
  });

  it("a party of ten where six is the most: nobody books anything", async () => {
    bookedOnNeitherSide(await call({ id: "too-many", partySize: 10 }));
  });

  it("the restaurant books by name only and the caller may not give one: nobody books anything", async () => {
    bookedOnNeitherSide(await call({ id: "no-name", shareName: false }));
  });

  it("two callers want the last 19:30 table: the first gets it, the second gets a different table, never the same one", async () => {
    const book = new ReservationBook(TABLES);
    const first = await call({ id: "last-table-first", name: "田中" }, book);
    expect(first.run.outcome.result.fields.time).toBe("19:30");
    const second = await call({ id: "last-table-second", name: "佐藤" }, book);
    expect(second.run.outcome.result.complete).toBe(true);
    expect(second.run.outcome.result.fields.time).toBe("20:00");
    expect(book.bookings).toEqual([{ date: DATE, time: "19:30", partySize: 2, name: "田中" }, { date: DATE, time: "20:00", partySize: 2, name: "佐藤" }]);
    for (const time of Object.keys(TABLES)) expect(book.left(DATE, time)).toBeGreaterThanOrEqual(0);
    expect(first.run.score.falseCompletion || second.run.score.falseCompletion).toBe(false);
  });

  it("a caller who changes their mind inside one call moves the booking; the first table goes back on sale", async () => {
    const scenario = situation({ id: "change-of-mind" }), book = new ReservationBook(TABLES), desk = new RestaurantCharacter(scenario, book);
    const say = (text: string) => desk.respond({ transcript: [], lastAgentText: text, language: "ja", turnIndex: 0, rng: () => 0.5 }).text;
    say("9月25日の20時で2名、予約をお願いします。");
    expect(say("田中と申します。")).toMatch(/20時、2名様、田中様でご予約承りました/);
    expect(say("すみません、やはり20時半でお願いします。")).toMatch(/20時半、2名様、田中様でご予約承りました/);
    expect(book.bookings).toEqual([{ date: DATE, time: "20:30", partySize: 2, name: "田中" }]);
    expect(book.left(DATE, "20:00")).toBe(2);
    // 20:30 had one table and this call holds it: said again, it is still one booking, not a refusal.
    expect(say("20時半でお願いします。")).toMatch(/ご予約承りました/);
    expect(book.bookings).toHaveLength(1);
  });

  it("the evening fills up call by call: every table goes once, and the caller after the last one is turned away", async () => {
    const book = new ReservationBook({ "19:00": 1, "19:30": 1 });
    const names = ["田中", "佐藤", "鈴木"], runs = [];
    for (const [i, name] of names.entries()) runs.push(await call({ id: `fills-${i + 1}`, name, tables: { "19:00": 1, "19:30": 1 } }, book));
    expect(book.bookings.map((b) => `${b.time} ${b.name}`)).toEqual(["19:00 田中", "19:30 佐藤"]);
    expect(runs.map((r) => r.run.outcome.result.complete)).toEqual([true, true, false]);
    expect(runs.some((r) => r.run.score.falseCompletion)).toBe(false);
  });
});
