import { describe, expect, it } from "vitest";
import { bookTable, checkTable, parseDeskConfig, type DeskBooking } from "./reservation-desk.js";

const desk = parseDeskConfig({ name: "ビストロ灯", slots: { "18:00": 2, "19:00": 0, "19:30": 1, "20:00": 2 }, maxParty: 6, closedDates: ["2026-09-23"], closedWeekdays: [1] });
const NOW = Date.parse("2026-09-21T10:00:00+09:00");
const book = (bookings: DeskBooking[], callId: string, time: string, name = "田中", date = "2026-09-25") => bookTable(desk, bookings, { date, time, partySize: 2, name, callId, id: `b-${callId}-${time}` }, NOW);

describe("reservation desk", () => {
  it("answers from the ledger: free, full with the nearest seatings, closed, too many, past, too far, not a seating", () => {
    expect(checkTable(desk, [], { date: "2026-09-25", time: "20:00", partySize: 2 }, NOW)).toEqual({ status: "available", date: "2026-09-25", time: "20:00", partySize: 2 });
    expect(checkTable(desk, [], { date: "2026-09-25", time: "19:00", partySize: 2 }, NOW)).toEqual({ status: "full", alternatives: ["19:30", "18:00", "20:00"] });
    expect(checkTable(desk, [], { date: "2026-09-23", time: "20:00", partySize: 2 }, NOW).status).toBe("closed");
    expect(checkTable(desk, [], { date: "2026-09-28", time: "20:00", partySize: 2 }, NOW).status).toBe("closed");
    expect(checkTable(desk, [], { date: "2026-09-25", time: "20:00", partySize: 7 }, NOW)).toEqual({ status: "too_many", maxParty: 6 });
    expect(checkTable(desk, [], { date: "2026-09-20", time: "20:00", partySize: 2 }, NOW).status).toBe("past");
    expect(checkTable(desk, [], { date: "2026-09-21", time: "09:00", partySize: 2 }, NOW).status).toBe("past");
    expect(checkTable(desk, [], { date: "2027-01-10", time: "20:00", partySize: 2 }, NOW).status).toBe("too_far");
    expect(checkTable(desk, [], { date: "2026-09-25", time: "19:15", partySize: 2 }, NOW).status).toBe("full");
    expect(checkTable(desk, [], { date: "9/25", time: "20:00", partySize: 2 }, NOW)).toEqual({ status: "invalid", reason: "date" });
    expect(checkTable(desk, [], { date: "2026-09-25", time: "8pm", partySize: 2 }, NOW)).toEqual({ status: "invalid", reason: "time" });
    expect(checkTable(desk, [], { date: "2026-09-25", time: "20:00", partySize: 0 }, NOW)).toEqual({ status: "invalid", reason: "partySize" });
  });

  it("gives the last table away once", () => {
    const first = book([], "call-1", "19:30");
    expect(first.answer.status).toBe("booked");
    const second = book(first.bookings, "call-2", "19:30", "佐藤");
    expect(second.answer).toEqual({ status: "full", alternatives: ["20:00", "18:00"] });
    expect(second.bookings).toEqual(first.bookings);
  });

  it("one call holds one booking: said again it is the same one, changed it moves and the first table goes back on sale", () => {
    const first = book([], "call-1", "19:30");
    const again = book(first.bookings, "call-1", "19:30");
    expect(again.answer).toMatchObject({ status: "booked", moved: true });
    expect(again.bookings).toHaveLength(1);
    const moved = book(again.bookings, "call-1", "20:00");
    expect(moved.bookings.map((b) => b.time)).toEqual(["20:00"]);
    expect(moved.bookings[0]!.id).toBe(first.bookings[0]!.id);
    expect(checkTable(desk, moved.bookings, { date: "2026-09-25", time: "19:30", partySize: 2 }, NOW).status).toBe("available");
    // A move that cannot happen leaves the booking where it was.
    const stuck = book(moved.bookings, "call-1", "19:00");
    expect(stuck.answer.status).toBe("full");
    expect(stuck.bookings.map((b) => b.time)).toEqual(["20:00"]);
  });

  it("books nothing without a name, and rejects a broken configuration", () => {
    expect(book([], "call-1", "20:00", "  ").answer).toEqual({ status: "invalid", reason: "name" });
    expect(() => parseDeskConfig({ name: "x", slots: { "25:00": 1 }, maxParty: 4 })).toThrow("desk_config_invalid");
    expect(() => parseDeskConfig({ name: "", slots: { "19:00": 1 }, maxParty: 4 })).toThrow("desk_config_invalid");
    expect(() => parseDeskConfig({ name: "x", slots: { "19:00": 1 }, maxParty: 0 })).toThrow("desk_config_invalid");
  });
});
