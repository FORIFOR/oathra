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

  it("requires an explicit purpose, consent prompt and bounded intake fields", () => {
    const c = defineCall({
      goal: "restaurant.reservation",
      intake: {
        purpose: "Offer a relevant follow-up",
        consentPrompt: "追加で2点だけ伺ってもよろしいでしょうか？",
        fields: [
          { key: "role", label: "ご担当", question: "ご担当を教えていただけますか？" },
          { key: "region", label: "地域", question: "お住まいの地域を教えていただけますか？" },
        ],
        maxQuestions: 2,
      },
    });
    expect(c.intake?.maxQuestions).toBe(2);
    expect(() => defineCall({
      goal: "x",
      intake: {
        purpose: "p",
        consentPrompt: "c",
        fields: [
          { key: "role", label: "r", question: "q" },
          { key: "role", label: "r2", question: "q2" },
        ],
      },
    })).toThrow(/duplicate intake field key/);
  });

  it("validates scene dependencies and canonical choices", () => {
    const c = defineCall({
      goal: "support.follow_up",
      require: { confirmed: true },
      intake: {
        purpose: "案内を適切にする",
        consentPrompt: "追加で伺ってもよろしいでしょうか？",
        startAfter: ["confirmed"],
        fields: [
          { key: "need", label: "必要な案内", question: "必要な案内はどちらでしょうか？", choices: ["導入", "請求"] },
          { key: "detail", label: "詳細", question: "詳細を教えていただけますか？", dependsOn: ["need"] },
        ],
      },
    });
    expect(c.intake?.startAfter).toEqual(["confirmed"]);
    expect(c.intake?.fields[0]?.choices).toEqual(["導入", "請求"]);
    expect(() => defineCall({
      goal: "x",
      intake: {
        purpose: "p",
        consentPrompt: "c",
        fields: [{ key: "detail", label: "d", question: "q", dependsOn: ["missing"] }],
      },
    })).toThrow(/unknown intake field dependency/);
    expect(() => defineCall({
      goal: "x",
      intake: {
        purpose: "p",
        consentPrompt: "c",
        fields: [
          { key: "a", label: "a", question: "a", dependsOn: ["b"] },
          { key: "b", label: "b", question: "b", dependsOn: ["a"] },
        ],
      },
    })).toThrow(/cyclic intake field dependency/);
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
