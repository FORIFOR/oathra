import { describe, expect, it } from "vitest";
import { conversationObservation, evaluateActionProof, type ActionExpectation, type ProofObservation } from "./proof.js";
import type { VerifiedResult } from "./types.js";

const expected: ActionExpectation = {
  action: "restaurant.reservation",
  fields: { date: "2026-09-20", time: "19:30", partySize: 2 },
};

function external(overrides: Partial<ProofObservation> = {}): ProofObservation {
  return {
    id: "msg-1",
    source: "email",
    observedAt: "2026-09-15T00:00:00.000Z",
    fields: { ...expected.fields },
    sourceVerified: true,
    referenceId: "reservation-1",
    expiresAt: "2026-09-22T00:00:00.000Z",
    ...overrides,
  };
}

function result(fields: Record<string, unknown>, complete = true): Pick<VerifiedResult, "complete" | "fields" | "evidence"> {
  return { complete, fields, evidence: [] };
}

describe("ActionProof", () => {
  it("keeps an action with no independent evidence at V0", () => {
    const proof = evaluateActionProof(expected, [], { now: new Date("2026-09-15T01:00:00.000Z") });
    expect(proof).toMatchObject({ level: "claimed", verified: false });
  });

  it("maps a complete conversation result to V1", () => {
    const observation = conversationObservation(expected, result(expected.fields), "2026-09-15T00:00:00.000Z");
    const proof = evaluateActionProof(expected, [observation], { now: new Date("2026-09-15T01:00:00.000Z") });
    expect(proof).toMatchObject({ level: "conversation", verified: true });
    expect(proof.evidenceIds).toEqual(["conversation:restaurant.reservation"]);
  });

  it("raises a matching authenticated email to V2", () => {
    const proof = evaluateActionProof(expected, [external()], { now: new Date("2026-09-15T01:00:00.000Z") });
    expect(proof).toMatchObject({ level: "confirmation", verified: true });
    expect(proof.evidenceIds).toEqual(["msg-1"]);
  });

  it("does not trust a matching message without source verification", () => {
    const proof = evaluateActionProof(expected, [external({ sourceVerified: false })], { now: new Date("2026-09-15T01:00:00.000Z") });
    expect(proof).toMatchObject({ level: "claimed", verified: false });
    expect(proof.checks[0]?.reasons).toContain("source identity was not verified");
  });

  it("retains conversation proof when an external confirmation conflicts", () => {
    const conversation = conversationObservation(expected, result(expected.fields), "2026-09-15T00:00:00.000Z");
    const confirmation = external({ fields: { ...expected.fields, time: "20:00" } });
    const proof = evaluateActionProof(expected, [conversation, confirmation], { now: new Date("2026-09-15T01:00:00.000Z") });
    expect(proof.level).toBe("conversation");
    expect(proof.verified).toBe(true);
    expect(proof.checks.find((check) => check.source === "email")?.mismatched).toEqual(["time"]);
  });

  it("rejects expired confirmations", () => {
    const proof = evaluateActionProof(expected, [external({ expiresAt: "2026-09-15T00:30:00.000Z" })], { now: new Date("2026-09-15T01:00:00.000Z") });
    expect(proof.level).toBe("claimed");
    expect(proof.checks[0]?.reasons).toContain("observation has expired");
  });

  it("supports an authenticated system record as V3", () => {
    const proof = evaluateActionProof(expected, [external({ id: "system-record-1", source: "reservation_api" })], { now: new Date("2026-09-15T01:00:00.000Z") });
    expect(proof).toMatchObject({ level: "system", verified: true });
  });

  it("supports an explicitly reported outcome as V4", () => {
    const proof = evaluateActionProof(expected, [external({ id: "outcome-record-1", source: "operator", referenceId: "visit-1" })], { now: new Date("2026-09-15T01:00:00.000Z") });
    expect(proof).toMatchObject({ level: "outcome", verified: true });
  });
});
