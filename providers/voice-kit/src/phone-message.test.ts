import { describe, expect, it } from "vitest";
import { definePhoneRequest, preparePhoneRequest, PHONE_PURPOSE_TEMPLATES } from "@oathra/contract";
import { conversationPolicies, GOODBYE_RE, HANGUP_REQUEST_RE, phoneMessageInstructions } from "./index.js";

const news = PHONE_PURPOSE_TEMPLATES.find((t) => t.id === "ai-news")!;
const contract = (language: "ja") => definePhoneRequest(preparePhoneRequest({ phone: "+819012345678", name: "山田", instruction: news.instruction[language], conversationMode: "chat" }));

describe("the AI news briefing", () => {
  it("may explain a verified story in three labelled parts only where the news lookup exists", () => {
    const withNews = phoneMessageInstructions(contract("ja"), true);
    expect(withNews).toContain("「ここからは私の考えですが」");
    expect(withNews).toContain("聞かれるのを待たずに自分からlookup_newsで調べて");
    expect(withNews).toContain("一度に話すのは一つの項目だけ");expect(withNews).toContain("相手の様子を短く伺い");
    expect(withNews).toContain("投資や購入の助言");
    expect(withNews).toContain("一、二文（15秒以内）"); // the ordinary summary rule stays for every other chat
    const without = phoneMessageInstructions(contract("ja"), false);
    expect(without).not.toContain("ここからは私の考えですが");
    expect(without).toContain("最新ニュースを調べる機能はこの接続では使えません");
    expect(without).not.toMatch(/\n\n/);
  });
});

describe("hanging up when asked", () => {
  it("every call says 失礼します and ends at once, and that goodbye is one the runtime hangs up on", () => {
    expect(conversationPolicies("ja")).toContain("「失礼します」");
    expect(conversationPolicies("ja")).toContain("すぐにend_callで終了");
    expect(conversationPolicies("en")).toContain("Hang-up policy");
    // The engines hang up once the callee asked to and the agent's line matches GOODBYE_RE.
    // Every phrase the policy names is one the engines' fallback also hears as a request to hang up.
    for (const phrase of ["切って", "もう切ります", "切っていい？", "電話切ります", "hang up", "end the call"]) expect(HANGUP_REQUEST_RE.test(phrase), phrase).toBe(true);
    for (const phrase of ["切符を買います", "野菜を切ります"]) expect(HANGUP_REQUEST_RE.test(phrase), phrase).toBe(false);
    expect(GOODBYE_RE.test("失礼します")).toBe(true);
    expect(GOODBYE_RE.test("承知しました。失礼いたします。")).toBe(true);
  });
});
