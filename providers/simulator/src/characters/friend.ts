import { parseTimes } from "@oathra/evidence";
import type { Scenario } from "@oathra/scenario";
import { GOODBYE_RE, jaDate, jaTime, type CalleeCharacter, type CalleeContext, type CalleeReply } from "../character.js";

type Knowledge = { date: string; free_from: string };

/**
 * A friend who is thrilled by the news and says yes to everything — without actually committing.
 * Being excited is not a promise: 「行きたい！たぶん行ける！」 settles nothing, and the plan only
 * exists once the friend has checked their schedule and says they will be there at a time that works.
 */
export class FriendCharacter implements CalleeCharacter {
  readonly name: string;
  private readonly k: Knowledge;
  private stage: "hype" | "checked" | "committed" = "hype";
  private committed: string | undefined;

  constructor(private readonly scenario: Scenario, private readonly rng: () => number) {
    this.name = scenario.callee.persona.name;
    const k = scenario.callee.knowledge as Partial<Knowledge>;
    this.k = { date: k.date ?? "2026-10-03", free_from: k.free_from ?? "20:30" };
  }

  private pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.rng() * xs.length)]!;
  }

  greeting(): string {
    return this.scenario.callee.greeting ?? "もしもしー！どしたのー？";
  }

  truth(): Record<string, unknown> {
    return this.committed ? { date: this.k.date, time: this.committed, confirmed: true } : { confirmed: false };
  }

  respond(ctx: CalleeContext): CalleeReply {
    const text = ctx.lastAgentText;
    if (GOODBYE_RE.test(text) || /またね|じゃあね|ばいばい|バイバイ/.test(text)) {
      return { text: this.pick(["うん、またねー！ばいばーい！", "はーい！またねー！"]), hangup: true };
    }
    const free = jaTime(this.k.free_from), day = jaDate(this.k.date);
    const times = parseTimes(text, "ja").filter((t) => !t.ambiguous).map((t) => t.value);

    if (this.stage === "hype") {
      this.stage = "checked";
      // All the enthusiasm in the world, and a hedge.
      return { text: `${this.pick(["えーーっ！？まじで！？", "うそでしょ！？ほんとに！？", "えっ、やば！！まじ！？"])}${this.pick(["おめでとう！！すごすぎる！", "やばいやばい、おめでとう！！", "天才じゃん！！おめでとう！"])}行きたい行きたい！たぶん行ける！` };
    }
    if (this.stage === "checked" && !this.committed) {
      if (times.includes(this.k.free_from)) {
        this.stage = "committed";
        this.committed = this.k.free_from;
        return { text: `${this.pick(["うん！", "やったー！", "おっけー！"])}${day}の${free}、絶対行く！${this.pick(["楽しみすぎる〜！！", "もう今からお腹すいてきた！！", "テンション上がってきた〜！！"])}` };
      }
      if (times.length && times.every((t) => t < this.k.free_from)) {
        return { text: `ちょっと待って、予定見るね！……あーっ、その日バイト${jaTime(shiftEnd(this.k.free_from))}までだ〜！${free}からならいける！` };
      }
      return { text: `${free}からならいけるよ！どう？` };
    }
    return { text: this.pick(["ほんと楽しみ！！", "当日までがんばれる〜！", "写真いっぱい撮ろうね！"]) };
  }
}

/** The shift ends half an hour before the friend is free. */
function shiftEnd(freeFrom: string): string {
  const [h, m] = freeFrom.split(":").map(Number) as [number, number];
  const total = h * 60 + m - 30;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
