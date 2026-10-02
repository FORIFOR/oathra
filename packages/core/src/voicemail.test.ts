import { describe, expect, it } from "vitest";
import { isMachineGreeting } from "./index.js";

describe("a recording is not an answer", () => {
  it.each([
    "ただいま電話に出ることができません。ピーという発信音のあとにメッセージをどうぞ。", "留守番電話サービスに接続します", "こちらは留守番電話です", "発信音の後にお名前とご用件をお話しください",
    "おかけになった電話は、電波の届かない場所にあるか、電源が入っていないためかかりません", "おかけになった電話番号は現在使われておりません", "お客様のご都合によりお繋ぎできません",
    "ただいま留守にしております", "伝言メモをお預かりします", "Please leave a message after the tone", "The person you are calling is not available", "ｖｏｉｃｅｍａｉｌ",
  ])("machine: %s", (text) => expect(isMachineGreeting(text)).toBe(true));
  it.each([
    "はい、山田です", "もしもし", "今ちょっと出られないのであとでかけ直します", "母は留守です", "伝言をお願いできますか", "ピーマンは苦手です", "電話に出るのが遅くなってすみません", "メッセージは受け取りました", "",
  ])("person: %s", (text) => expect(isMachineGreeting(text)).toBe(false));
});

describe("carrier announcements a second review showed were taken for a person", () => {
  it.each(["お留守番サービスに接続します。合図の音がしましたら、ご用件をお話しください。", "おかけになった電話をお呼びしましたが、お出になりません。", "ただいま電話に出られません。", "ピーッと鳴りましたらお名前とご用件をどうぞ。"])(
    "machine: %s", (text) => expect(isMachineGreeting(text)).toBe(true));
});
