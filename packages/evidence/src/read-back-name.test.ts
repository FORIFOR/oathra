/**
 * A real booking call (2026-10-15) was reported as not settled although the shop agreed twice. The shop's first
 * 「はい」 settled it, a recognition fragment 「ます」 took it back, and the AI's read-back
 * 「…6名、予約の名前は堀尾でよろしいでしょうか?」 was not heard as a confirm request because of the booking name in it;
 * nor was 「はい、よろしいです」 heard as a yes. Both now settle, and only after a yes to a read-back.
 */
import { describe, expect, it } from "vitest";
import { defineCall } from "@oathra/contract";
import { EvidenceEngine, evaluate } from "./index.js";

type Line = ["A" | "B", string];
const NOW = new Date("2026-10-15T01:00:00+09:00");
const booking = defineCall({ goal: "phone.message", language: "ja", require: { date: true, time: true, confirmed: true }, confirmation: "callee_acceptance" });
const ASK = "お忙しいところ失礼いたします。AIの音声アシスタントで、堀尾の代理でご予約のお願いでお電話しております。10月15日の20時に6名で予約をお願いできますでしょうか?";
const READ_BACK = "ありがとうございます。では、10月15日の20時に6名、予約の名前は堀尾でよろしいでしょうか?";
const settled = (lines: Line[]) => {
  const engine = new EvidenceEngine({ language: "ja", now: NOW, confirmation: "callee_acceptance" });
  lines.forEach(([who, text], i) => engine.ingest({ id: `t${i}`, source: who === "A" ? "caller" : "callee", text, t: i }));
  return evaluate(booking, engine, "completed").complete;
};

describe("a read-back that names the booking settles on the shop's yes", () => {
  it.each<[string, Line[]]>([
    ["the call as recorded", [["A", ASK], ["B", "はい"], ["B", "ます"], ["A", READ_BACK], ["B", "はい、よろしいです"], ["A", "はい、ありがとうございます。"]]],
    ["a held line, then the read-back", [["A", ASK], ["B", "少々お待ちください。"], ["A", READ_BACK], ["B", "はい、よろしいです。"]]],
    ["a plain yes to the read-back", [["A", ASK], ["B", "少々お待ちください。"], ["A", READ_BACK], ["B", "はい。"]]],
    ["the name with 様", [["A", ASK], ["B", "少々お待ちください。"], ["A", "10月15日の20時に6名、お名前は堀尾様でお間違いないでしょうか。"], ["B", "はい、大丈夫です。"]]],
    ["a polite read-back", [["A", ASK], ["B", "少々お待ちください。"], ["A", "ありがとうございます。それでは、10月15日20時に6名様、ご予約のお名前は堀尾様でよろしいでしょうか。"], ["B", "はい、よろしいです。"]]],
  ])("%s", (_n, lines) => expect(settled(lines)).toBe(true));

  it.each<[string, Line[]]>([
    ["the shop corrects the name", [["A", ASK], ["B", "少々お待ちください。"], ["A", READ_BACK], ["B", "いえ、その時間は満席です。"]]],
    ["a bare よろしいです to the request, no yes and no read-back", [["A", "10月15日の20時に6名で予約をお願いします。"], ["B", "よろしいです。"]]],
    ["よろしいです with a condition", [["A", ASK], ["B", "少々お待ちください。"], ["A", READ_BACK], ["B", "はい、よろしいです、空いていれば。"]]],
    ["another request rides on the name", [["A", ASK], ["B", "少々お待ちください。"], ["A", "では10月15日の20時に6名、名前は堀尾で、駐車場もお借りしてよろしいでしょうか。"], ["B", "はい。"]]],
    ["the recording reads the request back", [["A", ASK], ["B", "少々お待ちください。"], ["A", READ_BACK], ["B", "ただいま電話に出ることができません。"]]],
    ["the AI asks for the name", [["A", ASK], ["B", "少々お待ちください。"], ["A", "10月15日の20時に6名で、お名前を伺ってもよろしいでしょうか。"], ["B", "はい。"]]],
    ["a question back", [["A", ASK], ["B", "少々お待ちください。"], ["A", READ_BACK], ["B", "はい、よろしいですか?"]]],
  ])("not settled: %s", (_n, lines) => expect(settled(lines)).toBe(false));
});
