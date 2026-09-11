import { describe, expect, it } from "vitest";
import { checkConstraints, defineCall, isPermitted, requiredFields } from "./index.js";

describe("defineCall", () => {
  it("applies defaults", () => {
    const c = defineCall({ goal: "restaurant.reservation" });
    expect(c.language).toBe("ja");
    expect(c.budget.maxTurns).toBe(60);
    expect(c.permissions).toEqual({});
  });

  it("rejects unknown keys", () => {
    expect(() => defineCall({ goal: "x", foo: 1 } as never)).toThrow();
  });

  it("lists required fields in order", () => {
    const c = defineCall({
      goal: "g",
      require: { date: true, time: false, partySize: true },
    });
    expect(requiredFields(c)).toEqual(["date", "partySize"]);
  });

  it("denies unknown permissions by default", () => {
    const c = defineCall({ goal: "g", permissions: { reserve: true } });
    expect(isPermitted(c, "reserve")).toBe(true);
    expect(isPermitted(c, "payment")).toBe(false);
  });
});

describe("checkConstraints", () => {
  it("compares times as zero-padded strings", () => {
    const r = checkConstraints({ time: { gte: "19:00" } }, { time: "19:30" });
    expect(r.satisfied).toBe(true);
    const bad = checkConstraints({ time: { gte: "19:00" } }, { time: "18:30" });
    expect(bad.satisfied).toBe(false);
    expect(bad.violations[0]?.rule).toBe("gte");
  });

  it("compares numbers numerically", () => {
    const r = checkConstraints({ price: { lte: 20000 } }, { price: 18800 });
    expect(r.satisfied).toBe(true);
    expect(checkConstraints({ price: { lte: 20000 } }, { price: 23500 }).satisfied).toBe(false);
  });

  it("reports missing fields as unknown, not violations", () => {
    const r = checkConstraints({ price: { lte: 20000 } }, {});
    expect(r.satisfied).toBe(true);
    expect(r.unknown).toEqual(["price"]);
  });

  it("supports eq on booleans and oneOf", () => {
    expect(checkConstraints({ breakfast: { eq: true } }, { breakfast: true }).satisfied).toBe(true);
    expect(checkConstraints({ breakfast: { eq: true } }, { breakfast: false }).satisfied).toBe(false);
    expect(checkConstraints({ room: { oneOf: ["twin", "double"] } }, { room: "single" }).satisfied).toBe(false);
  });
});
