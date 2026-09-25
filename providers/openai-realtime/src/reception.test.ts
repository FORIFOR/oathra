import { describe, expect, it } from "vitest";
import { defineRestaurantReception, definePhoneInbound } from "@oathra/contract";
import { bookTable, checkTable, parseDeskConfig, type DeskBooking } from "@oathra/core";
import { OpenAILiveAgent } from "./live.js";
import { deskTool, notReadBack, type DeskEvent, type ReservationDesk } from "@oathra/voice-kit";

const config = parseDeskConfig({ name: "ビストロ灯", slots: { "19:00": 0, "19:30": 1, "20:00": 2 }, maxParty: 6 });
const NOW = new Date("2026-09-21T10:00:00+09:00");
const contract = defineRestaurantReception({ restaurantName: "ビストロ灯", callerPhone: "+819000000000", today: "2026-09-21", seatings: Object.keys(config.slots), maxParty: 6 });

function ledgerDesk(callId = "call-1") {
  const state = { bookings: [] as DeskBooking[] };
  const desk: ReservationDesk = {
    check: (r) => checkTable(config, state.bookings, r, NOW.getTime(), callId),
    book: (r) => { const out = bookTable(config, state.bookings, { ...r, callId, id: `b-${state.bookings.length + 1}` }, NOW.getTime()); state.bookings = out.bookings; return out.answer; },
  };
  return { desk, state };
}

function harness(desk: ReservationDesk | undefined, c = contract) {
  const events: DeskEvent[] = [], sent: Record<string, unknown>[] = [];
  const agent = new OpenAILiveAgent({ contract: c, newsSearch: false, ...(desk ? { desk } : {}), onDesk: (e) => events.push(e), today: () => NOW }) as unknown as {
    started: boolean; bridge: unknown; ws: unknown; onMessage: (m: Record<string, unknown>) => void; flushOut: () => void; backendInstructions: () => string;
  };
  agent.started = true;
  agent.bridge = { sendAudio: () => {}, clearAudio: () => {}, emit: () => {}, now: () => 1000 };
  agent.ws = { readyState: 1, send: (raw: string) => sent.push(JSON.parse(raw) as Record<string, unknown>) };
  const tool = async (name: string, args: Record<string, unknown>, id: string) => {
    agent.onMessage({ type: "response.event", event: { type: "response.output_item.done", item: { type: "function_call", name, call_id: id, arguments: JSON.stringify(args) } } });
    await new Promise((r) => setTimeout(r, 0));
    const item = sent.find((m) => m.event_id === `tool_${id}`)?.item as { output: string } | undefined;
    return item ? JSON.parse(item.output) as Record<string, unknown> : undefined;
  };
  const say = (text: string) => { agent.onMessage({ type: "session.output_transcript.delta", delta: text }); agent.flushOut(); };
  return { agent, events, sent, tool, say };
}

const BOOKING = { date: "2026-09-25", time: "19:30", partySize: 2, name: "田中" };

describe("restaurant reception", () => {
  it("reads what was said aloud with the deterministic parsers, not the model's word for it", () => {
    expect(notReadBack(["9月25日の19時半、2名様、田中様でよろしいでしょうか？"], BOOKING, NOW, "ja")).toEqual([]);
    expect(notReadBack(["あさっての午後8時、お二人様、田中様ですね。"], { date: "2026-09-23", time: "20:00", partySize: 2, name: "田中" }, NOW, "ja")).toEqual([]);
    expect(notReadBack(["19時半でお取りしますね。"], BOOKING, NOW, "ja")).toEqual(["date", "partySize", "name"]);
    // The values of another booking do not cover this one.
    expect(notReadBack(["9月26日の19時半、2名様、田中様でよろしいでしょうか？"], BOOKING, NOW, "ja")).toEqual(["date"]);
  });

  it("writes nothing down until the booking has been read back aloud, then writes it once", async () => {
    const { desk, state } = ledgerDesk(), h = harness(desk);
    expect(await h.tool("check_table", { date: "2026-09-25", time: "19:00", partySize: 2 }, "c1")).toEqual({ status: "full", alternatives: ["19:30", "20:00"] });
    expect(await h.tool("book_table", BOOKING, "b1")).toEqual({ status: "read_back_required", missing: ["date", "time", "partySize", "name"] });
    expect(state.bookings).toEqual([]);
    h.say("9月25日の19時半、2名様、田中様でよろしいでしょうか？");
    expect(await h.tool("book_table", BOOKING, "b2")).toMatchObject({ status: "booked", booking: { ...BOOKING, callId: "call-1" } });
    // The same tool call delivered twice is one booking; every answered call lets Live continue.
    expect(await h.tool("book_table", BOOKING, "b2")).toBeDefined();
    expect(state.bookings).toHaveLength(1);
    expect(h.sent.filter((m) => m.type === "response.create")).toHaveLength(3);
    expect(h.events.map((e) => `${e.type}:${e.result.status}`)).toEqual(["desk.check:full", "desk.book:read_back_required", "desk.book:booked"]);
  });

  it("a change on the same call moves the booking, and the last table is never given to a second call", async () => {
    const first = ledgerDesk("call-1"), h = harness(first.desk);
    h.say("9月25日の19時半、2名様、田中様でよろしいでしょうか？");
    await h.tool("book_table", BOOKING, "b1");
    h.say("では9月25日の20時、2名様、田中様に変更でよろしいでしょうか？");
    expect(await h.tool("book_table", { ...BOOKING, time: "20:00" }, "b2")).toMatchObject({ status: "booked", moved: true });
    expect(first.state.bookings.map((b) => b.time)).toEqual(["20:00"]);

    const shared = ledgerDesk("call-2");
    shared.state.bookings = [{ id: "b-0", ...BOOKING, callId: "call-0", createdAt: 0 }];
    const other = harness(shared.desk);
    other.say("9月25日の19時半、2名様、佐藤様でよろしいでしょうか？");
    expect(await other.tool("book_table", { ...BOOKING, name: "佐藤" }, "b1")).toEqual({ status: "full", alternatives: ["20:00"] });
    expect(shared.state.bookings).toHaveLength(1);
  });

  it("a desk that fails books nothing and says so; a contract that is not a reception never reaches a desk", async () => {
    const broken: ReservationDesk = { check: () => { throw new Error("db"); }, book: () => { throw new Error("db"); } };
    expect(await deskTool(broken, "check_table", BOOKING, [], NOW, "ja")).toEqual({ status: "unavailable" });
    const { desk, state } = ledgerDesk();
    const inbound = harness(desk, definePhoneInbound({ ownerName: "田中", callerPhone: "+819000000000" }));
    inbound.say("9月25日の19時半、2名様、田中様でよろしいでしょうか？");
    expect(await inbound.tool("book_table", BOOKING, "b1")).toEqual({ status: "unavailable" });
    expect(state.bookings).toEqual([]);
    expect(inbound.agent.backendInstructions()).not.toContain("book_table");
    expect(harness(desk).agent.backendInstructions()).toContain("ビストロ灯");
  });
});
