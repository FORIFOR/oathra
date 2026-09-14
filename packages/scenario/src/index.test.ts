import { describe, expect, it } from "vitest";
import { contractFromScenario, parseScenario } from "./index.js";

describe("scenario intake", () => {
  it("carries a consent-gated intake from YAML into the CallContract", () => {
    const parsed = parseScenario(`
version: 1
id: intake-example
title: Intake example
language: ja
domain: generic
mission:
  objective: support.followup
  require:
    confirmed: true
  permissions:
    ask: true
  intake:
    purpose: 利用後の案内を適切にする
    consentPrompt: 追加で1点だけ伺ってもよろしいでしょうか？
    fields:
      - key: role
        label: ご担当
        question: ご担当を教えていただけますか？
    maxQuestions: 1
    stopOnDecline: true
callee:
  persona:
    name: サポート窓口
`);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const contract = contractFromScenario(parsed.scenario);
    expect(contract.intake).toMatchObject({
      purpose: "利用後の案内を適切にする",
      maxQuestions: 1,
      stopOnDecline: true,
    });
    expect(contract.intake?.fields[0]).toEqual({
      key: "role",
      label: "ご担当",
      question: "ご担当を教えていただけますか？",
    });
  });
});
