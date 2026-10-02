import { describe, expect, it } from "vitest";
import { checkInReport, type CheckInTurn } from "./index.js";

const call = (...lines: string[]): CheckInTurn[] => lines.map((line, i) => ({ id: `t${i}`, source: line.startsWith("A:") ? "caller" : "callee", text: line.slice(2).trim() }));
const answers = (turns: CheckInTurn[]) => Object.fromEntries(checkInReport(turns).items.map((i) => [i.topic, i.answer]));

describe("what a wellbeing call heard", () => {
  it("clear answers are recorded with the person's own words", () => {
    const report = checkInReport(call(
      "A: おはようございます。今日のお体の調子はいかがですか。", "B: おかげさまで元気ですよ。",
      "A: 朝ご飯は召し上がりましたか。", "B: はい、食べました。",
      "A: お薬は飲まれましたか。", "B: まだ飲んでいません。",
      "A: 夜はよく眠れましたか。", "B: ぐっすり眠れました。",
      "A: 何か困っていることはありますか。", "B: 特にないです。",
    ));
    expect(Object.fromEntries(report.items.map((i) => [i.topic, i.answer]))).toEqual({ condition: "yes", meal: "yes", medication: "no", sleep: "yes", help: "no" });
    expect(report.items.find((i) => i.topic === "medication")).toMatchObject({ quote: "まだ飲んでいません。", turn: "t5", question: "お薬は飲まれましたか。" });
    expect(report.answered).toBe(true);
    expect(report.attention).toBe("concern"); // a missed medicine is for a human to see
  });

  it.each([
    ["お薬は飲みましたか。", "飲んだっけなあ", "medication"],
    ["お薬は飲みましたか。", "たぶん飲んだと思う", "medication"],
    ["朝ご飯は食べましたか。", "どうだったかな、覚えてない", "meal"],
    ["朝ご飯は食べましたか。", "食べたような気がする", "meal"],
    ["お薬は飲みましたか。", "はい、いや、まだだった", "medication"],
    ["お薬は飲みましたか。", "今日はいい天気ですね", "medication"],
    ["夜は眠れましたか。", "眠れたかなあ", "sleep"],
  ])("a hedged, contradicted or off-topic answer is unclear, never yes: %s → %s", (question, reply, topic) => {
    expect(answers(call(`A: ${question}`, `B: ${reply}`))[topic]).toBe("unclear");
  });

  it("nothing is recorded for a topic the agent never asked about, and silence is not an answer", () => {
    const report = checkInReport(call("A: お薬は飲みましたか。"));
    expect(answers(call("A: お薬は飲みましたか。"))).toEqual({ condition: "not_asked", meal: "not_asked", medication: "no_answer", sleep: "not_asked", help: "not_asked" });
    expect(report.answered).toBe(false);
  });

  it("the agent's own statement does not open a topic, and its words are never read as the person's", () => {
    expect(answers(call("A: お薬の時間ですね。ご飯は食べましたと伺っています。", "B: はい。"))).toMatchObject({ medication: "not_asked", meal: "not_asked" });
  });

  it("two questions answered in one breath are both unclear", () => {
    expect(answers(call("A: ご飯は食べましたか。お薬は飲みましたか。", "B: はい。"))).toMatchObject({ meal: "unclear", medication: "unclear" });
  });

  it("a later clear answer that contradicts an earlier one is unclear", () => {
    expect(answers(call("A: お薬は飲みましたか。", "B: 飲みました。", "A: お薬は本当に飲まれましたか。", "B: いや、飲んでないです。")).medication).toBe("unclear");
  });

  it("trouble said in passing is flagged even when no question asked for it", () => {
    const report = checkInReport(call("A: 朝ご飯は食べましたか。", "B: 食べました。でも昨日転んで腰が痛いんです。"));
    expect(report.signals.map((s) => s.category)).toEqual(["fall", "pain"]);
    expect(report.signals[0]!.quote).toContain("昨日転んで");
    expect(report.attention).toBe("concern");
  });

  it("an emergency word outranks everything", () => {
    expect(checkInReport(call("A: お体の調子はいかがですか。", "B: 胸が痛くて息が苦しい")).attention).toBe("emergency");
  });

  it("feeling well with a complaint in the same line is unclear, not well", () => {
    expect(answers(call("A: 体調はいかがですか。", "B: 元気だけど膝が痛い")).condition).toBe("unclear");
  });

  it("a quiet, well call needs no attention", () => {
    const report = checkInReport(call("A: お体の調子はいかがですか。", "B: 変わりないですよ。", "A: 困っていることはありますか。", "B: 大丈夫です。"));
    expect(report.attention).toBe("none");
  });

  it("an interrupted agent question is ignored", () => {
    const turns = call("A: お薬は飲み", "B: はい");
    turns[0]!.interrupted = true;
    expect(answers(turns).medication).toBe("not_asked");
  });
});

describe("the note for a relative", () => {
  const who = { name: "山本 ハル", when: "10月2日 9時ごろ", from: "ひかり苑" };
  const call = (...lines: string[]) => lines.map((line, i) => ({ id: `t${i}`, source: line.startsWith("A:") ? "caller" : "callee", text: line.slice(2).trim() }));
  it("says what was said, in the person's words, and that it is not an observation", async () => {
    const { checkInNote } = await import("./index.js");
    const note = checkInNote(checkInReport(call("A: 朝ご飯は召し上がりましたか。", "B: はい、食べました。", "A: お薬は飲まれましたか。", "B: 飲んだっけなあ。", "A: 夜は眠れましたか。")), who);
    expect(note).toContain("山本 ハルさんへのひかり苑からのお電話（10月2日 9時ごろ）のご報告です。");
    expect(note).toContain("・食事: 「はい、食べました。」と話されました。");
    expect(note).toContain("・お薬: はっきりしたお返事ではありませんでした。（「飲んだっけなあ。」と話されました。）");
    expect(note).not.toContain("睡眠");
    expect(note.endsWith("この内容は電話でご本人が話されたことの記録で、ご本人の様子を確かめたものではありません。")).toBe(true);
    expect(note).not.toMatch(/飲みました。$|お元気です|問題ありません/m);
  });
  it("an emergency line is never passed on as detail: the reader is sent to the staff", async () => {
    const { checkInNote } = await import("./index.js");
    const note = checkInNote(checkInReport(call("A: お体の調子はいかがですか。", "B: 元気ですよ。", "B: でもさっき胸が痛くて息が苦しかった")), who);
    expect(note).toContain("すぐに確かめたほうがよい言葉がありました。くわしくは職員にお尋ねください。");
  });
  it("an unanswered call says only that", async () => {
    const { checkInNote } = await import("./index.js");
    expect(checkInNote(checkInReport([]), who)).toBe("山本 ハルさんへのひかり苑からのお電話（10月2日 9時ごろ）のご報告です。\nお電話に出られなかったか、お話ができませんでした。\nこの内容は電話での応答の記録で、ご本人の様子を確かめたものではありません。");
  });
});
