import { describe, expect, it } from "vitest";
import { detectDistress, distressLevel } from "./index.js";

const level = (text: string) => distressLevel(detectDistress(text));

describe("words that mean someone should read this line", () => {
  it.each([
    "助けてください", "さっき倒れてしまって", "立てないんです", "息が苦しくて", "胸が痛いんです", "もう死にたい", "生きていても仕方ない",
    "救急車を呼んでほしい", "血が止まらない", "ろれつが回らなくて", "ｈｅｌｐ　ｍｅ",
  ])("emergency: %s", (text) => expect(level(text)).toBe("emergency"));

  it.each([
    "昨日転んでしまって", "腰が痛いんですよ", "めまいがしてね", "朝から何も食べてないの", "薬を飲み忘れました", "薬は飲んでいません",
    "夜眠れなくて", "ひとりで寂しいのよ", "熱があるみたい", "食欲がなくて", "気分が悪いです",
  ])("concern: %s", (text) => expect(level(text)).toBe("concern"));

  it.each([
    "元気ですよ", "痛いところはないです", "転んだりはしていません", "どこも痛くないよ", "ご飯は食べました", "薬は飲みました",
    "よく眠れています", "落ち着いて過ごしています", "いたいけな子でね", "こわいろを変えて話すのよ", "熱はありません", "",
  ])("nothing: %s", (text) => expect(level(text)).toBeNull());

  it("an emergency word stands even when taken back in the same breath", () => {
    expect(level("助けて…いや、大丈夫です")).toBe("emergency");
  });
  it("names what it heard, so the alert can quote it", () => {
    expect(detectDistress("昨日転んで、腰が痛いんです")).toEqual([
      { level: "concern", category: "fall", phrase: "転んで" },
      { level: "concern", category: "pain", phrase: "痛い" },
    ]);
  });
  it("a denial of one thing does not hide another in the same line", () => {
    expect(detectDistress("痛いところはないけど、夜眠れなくて").map((s) => s.category)).toEqual(["mood"]);
  });
});

describe("lines a second review showed were missed", () => {
  it.each(["転んでから足が動かない。", "転んでしまって、起きられない。", "頭が痛くてたまらない。", "めまいがして立っていられない。", "痛いけど誰も来てくれない。", "動けん。", "立てへん。", "もう死んでもええ。", "腰が動かんのよ、いや腰が動かないの。"])(
    "flagged: %s", (text) => expect(level(text)).not.toBeNull());
  it.each(["転んでから足が動かない。", "転んでしまって、起きられない。", "めまいがして立っていられない。", "動けん。", "立てへん。", "もう死んでもええ。"])(
    "emergency: %s", (text) => expect(level(text)).toBe("emergency"));
  it.each(["痛いところは特にないです", "転んだりはしておりません", "痛いとかはありません", "めまいはないです"])("still a denial: %s", (text) => expect(level(text)).toBeNull());
});
