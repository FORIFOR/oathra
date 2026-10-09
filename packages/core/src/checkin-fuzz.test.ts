import { describe, expect, it } from "vitest";
import { checkInReport } from "./index.js";

// The one error that matters in a care setting: recording "took the medicine" / "ate" when the person did not say so.
// Seeded, so a failure names a reproducible dialogue.
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

const QUESTIONS = {
  medication: ["お薬は飲まれましたか。", "今朝のお薬は飲みましたか？", "お薬はもう服用されましたか。", "くすりは飲みましたか。"],
  meal: ["朝ご飯は召し上がりましたか。", "お昼は食べましたか？", "お食事は済まされましたか。", "ごはんは食べられましたか。"],
} as const;
const NOT_DONE = {
  medication: ["まだ飲んでいません", "飲んでないです", "飲み忘れました", "今日は飲んでない", "まだです", "いいえ", "飲めなかった", "薬がなくなってしまって", "あとで飲みます", "これから飲むところ", "飲まなかった"],
  meal: ["まだ食べていません", "食べてないです", "食欲がなくて", "今日は食べてない", "まだです", "いいえ", "食べられなかった", "これから食べます", "抜いてしまいました", "何も食べてない"],
} as const;
const UNSURE = ["飲んだっけ", "たぶん", "どうだったかな", "覚えてないなあ", "忘れちゃった", "わからない", "さあ", "飲んだかもしれない", "食べたような気がする", "食べたと思うけど"];
const NOISE = ["えーと、", "あのね、", "そうねえ、", "んー、", "", "", "ちょっと待ってね、", "ああ、"];
const TAIL = ["", "。", "ね。", "よ。", "の。", "んです。", "、すみません。", "、ごめんなさいね。"];
const ASIDE = ["", "", "", "今日は寒いですね。", "娘が来るんです。", "テレビを見ていました。"];

describe("check-in fuzz", () => {
  it("never records yes when the person said no or was unsure (10,000 seeded dialogues)", () => {
    const wrong: string[] = [];
    for (let seed = 1; seed <= 10000; seed++) {
      const r = rng(seed), topic = r() < 0.5 ? "medication" : "meal";
      const reply = pick(r, NOISE) + (r() < 0.6 ? pick(r, NOT_DONE[topic]) : pick(r, UNSURE)) + pick(r, TAIL);
      const turns = [
        { source: "caller", text: "おはようございます。" + pick(r, ASIDE) },
        { source: "caller", text: pick(r, QUESTIONS[topic]) },
        { source: "callee", text: reply },
        ...(r() < 0.3 ? [{ source: "callee", text: pick(r, ASIDE) || "はい" }] : []),
      ];
      const item = checkInReport(turns).items.find((i) => i.topic === topic)!;
      if (item.answer === "yes") wrong.push(`seed ${seed}: ${turns[1]!.text} → ${reply}`);
    }
    expect(wrong.slice(0, 10)).toEqual([]);
  });
});
