import { parseSerials } from "@oathra/evidence";
import type { Scenario } from "@oathra/scenario";
import { GOODBYE_RE, spellSerial, type CalleeCharacter, type CalleeContext, type CalleeReply } from "../character.js";

type Knowledge = { serial: string; label?: string };

/**
 * Support desk that reads out a serial / confirmation number and checks the
 * caller's read-back. Tests entity accuracy: one wrong character fails.
 */
export class SerialCharacter implements CalleeCharacter {
  readonly name: string;
  private readonly k: Knowledge;
  private readCount = 0;
  private matched = false;

  constructor(private readonly scenario: Scenario) {
    this.name = scenario.callee.persona.name;
    const k = scenario.callee.knowledge as Partial<Knowledge>;
    this.k = { serial: (k.serial ?? "RZ7K3Q91XA").toUpperCase(), label: k.label ?? "シリアル番号" };
  }

  greeting(): string {
    return this.scenario.callee.greeting ?? `お電話ありがとうございます、${this.name}サポートでございます。`;
  }

  truth(): Record<string, unknown> {
    return { serial: this.k.serial, matched: this.matched };
  }

  private readOut(): string {
    this.readCount++;
    return `${this.k.label}をお伝えします。${spellSerial(this.k.serial)}、です。復唱をお願いいたします。`;
  }

  respond(ctx: CalleeContext): CalleeReply {
    const text = ctx.lastAgentText;
    if (GOODBYE_RE.test(text) && !/[?？]/.test(text)) {
      return { text: "失礼いたします。", hangup: true };
    }
    const codes = parseSerials(text).map((c) => c.value.replace(/[^A-Z0-9]/g, ""));
    if (codes.length) {
      if (codes.includes(this.k.serial.replace(/[^A-Z0-9]/g, ""))) {
        this.matched = true;
        return { text: `はい、${spellSerial(this.k.serial)}、で合っております。` };
      }
      if (this.readCount >= 3) return { text: "申し訳ございません、こちらでは確認が取れませんでした。" };
      return { text: `いえ、違います。もう一度お伝えします。${spellSerial(this.k.serial)}、です。` };
    }
    if (/シリアル|番号|serial|number|もう一度|再度/.test(text) || this.readCount === 0) {
      return { text: this.readOut() };
    }
    return { text: this.matched ? "他にご用件はございますか？" : "恐れ入ります、復唱をお願いいたします。" };
  }
}
