/**
 * ScriptedAgent — a deterministic caller brain that needs no API key.
 *
 * It is intentionally simple: it reads the mission view the runtime gives it
 * (verified / pending / missing / violations), decides the next move from
 * the contract, and never claims success itself. It exists so that
 * `npx oathra demo` works offline and so that LLM brains have a baseline
 * to beat in Agent Battle.
 */
import { checkConstraints, isPermitted, type CallContract } from "@oathra/contract";
import { AGREEMENT_RE, HEDGE_RE, parsePrices, parseTimes, REFUSAL_RE } from "@oathra/evidence";
import type { BrainContext, BrainProvider, BrainResponse } from "@oathra/core";
import { enDate, enTime, jaDate, jaPrice, jaTime, NAME_ASK_RE, spellSerial } from "./character.js";

/** The callee asks to hear it again (not the callee repeating itself: 「もう一度お伝えします」). */
const REPEAT_RE = /もう一度(?:お願い|おっしゃって|お聞かせ|言って)|再度お願い|お電話が遠い|聞き取れ(?:ません|なかった)|say that again|repeat that|could you repeat|line is bad|didn't catch/i;
/** Someone else picked up: the request has to be made from the start. */
const TRANSFER_RE = /お電話代わり|代わりました|担当の者に代わ|transfer you|this is \w+ speaking|you're through to/i;
/** "Please hold": wait, do not restate. */
const HOLD_RE = /少々お待ち|そのままお待ち|お待ちください|one moment|hold on|please hold|hold the line|bear with me/i;

type Domain = "restaurant" | "hotel" | "shop" | "serial" | "generic";

function domainOf(contract: CallContract): Domain {
  const g = contract.goal.split(".")[0] ?? "";
  if (g === "restaurant" || g === "hotel" || g === "shop" || g === "serial") return g;
  return "generic";
}

export class ScriptedAgent implements BrainProvider {
  readonly name = "scripted";
  private priceAttempts = 0;
  private altAsks = 0;
  private hedgeAsks = 0;
  private closing = false;
  private lastLine = "";
  private repeats = 0;
  private lastTurn = -1;
  /** Last line with content (not a "please hold" acknowledgement, not a repeat): what to say again when asked. */
  private lastSubstantive = "";
  /** Set by decide() when the reply is a wait or a deliberate repeat; those never count as a stall. */
  private kind: "normal" | "wait" | "repeat" = "normal";
  private waits = 0;
  private repeatsAsked = 0;

  async respond(ctx: BrainContext): Promise<BrainResponse> {
    this.kind = "normal";
    const r = this.decide(ctx);
    const kind = this.kind;
    // Stall guard: asking the same thing a third time never helps; leave politely instead of looping.
    // (a runtime retry of the same turn — signalled by hints — is not a new repeat; neither is a hold
    // acknowledgement or repeating a line the callee asked to hear again)
    if (r.action !== "hangup" && !ctx.hints?.length && ctx.turnIndex !== this.lastTurn && kind === "normal") {
      this.lastTurn = ctx.turnIndex;
      this.repeats = r.text === this.lastLine ? this.repeats + 1 : 0;
      this.lastLine = r.text;
      this.lastSubstantive = r.text;
      if (this.repeats >= 2) return { text: ctx.language === "en" ? "Understood. We'll try another day. Thank you, goodbye." : "承知しました。では今回は見送らせていただきます。ありがとうございました。", action: "hangup" };
    }
    return r;
  }

  private decide(ctx: BrainContext): BrainResponse {
    const { contract, mission, transcript } = ctx;
    const en = contract.language === "en";
    const fmtTime = en ? enTime : jaTime;
    const fmtDate = en ? enDate : jaDate;
    const domain = domainOf(contract);
    const input = contract.input as Record<string, unknown>;
    const last = [...transcript].reverse().find((t) => t.source === "callee");
    const lastText = last?.text ?? "";
    const budget = typeof contract.constraints.price?.lte === "number" ? contract.constraints.price.lte : undefined;
    const after = typeof contract.constraints.time?.gte === "string" ? contract.constraints.time.gte : undefined;
    const before = typeof contract.constraints.time?.lte === "string" ? contract.constraints.time.lte : undefined;
    const date = typeof input.date === "string" ? input.date : undefined;
    const party = typeof input.partySize === "number" ? input.partySize : undefined;
    const name = typeof input.name === "string" ? input.name : undefined;

    // 0. Optional intake starts only after the booking terms are settled. It is
    // consent-gated, bounded and driven entirely by the contract's declared fields.
    const missionSettled = mission.violations.length === 0 && mission.missing.length === 0;
    const intake = ctx.intake;
    if (ctx.turnIndex > 0 && missionSettled && intake && intake.status !== "disabled" && intake.status !== "declined" && intake.status !== "complete") {
      const intakeConfig = contract.intake;
      if (intakeConfig && (intake.status === "not_started" || intake.status === "awaiting_consent")) {
        return { text: intakeConfig.consentPrompt, intakeQuestion: { kind: "consent" } };
      }
      if (intakeConfig && intake.status === "active") {
        if (intake.askedQuestions >= (intake.maxQuestions ?? intakeConfig.maxQuestions)) {
          return { text: en ? "Thank you for sharing that. Goodbye." : "お聞かせいただき、ありがとうございました。失礼いたします。", action: "hangup" };
        }
        const answered = new Set(intake.answers.map((answer) => answer.key));
        const declined = new Set(intake.declined);
        const next = intakeConfig.fields.find((field) => !answered.has(field.key) && !declined.has(field.key));
        if (next) return { text: next.question, intakeQuestion: { kind: "field", field: next.key } };
      }
    }

    // 0b. Mission complete -> close politely.
    if (ctx.turnIndex > 0 && mission.missing.length === 0 && mission.violations.length === 0) {
      this.closing = true;
      return { text: en ? "Thank you very much. See you then, goodbye." : "ありがとうございます。それではよろしくお願いいたします。失礼いたします。", action: "hangup" };
    }

    // 1. Opening line.
    if (ctx.turnIndex === 0) return { text: this.opener(domain, contract) };

    // 1b. A new person on the line needs the whole request (checked before the hold: 「代わりますので少々お待ちください」).
    if (TRANSFER_RE.test(lastText) && this.repeatsAsked < 3) {
      this.repeatsAsked++;
      this.kind = "repeat";
      return { text: this.opener(domain, contract), verbatim: true };
    }
    // 1c. A hold is not a stall: acknowledge and wait (a few times at most).
    if (HOLD_RE.test(lastText) && !/\d|時|円|名|\b[ap]m\b/i.test(lastText) && this.waits < 3) {
      this.waits++;
      this.kind = "wait";
      return { text: en ? "Sure, I'll hold." : "はい、お待ちいたします。" };
    }
    // 1d. "say that again" needs the last line with content.
    if (REPEAT_RE.test(lastText) && this.repeatsAsked < 3) {
      this.repeatsAsked++;
      this.kind = "repeat";
      return { text: this.lastSubstantive || this.opener(domain, contract), verbatim: true };
    }

    // 2. Callee asked for a name.
    if (NAME_ASK_RE.test(lastText)) {
      if (name && isPermitted(contract, "share_name")) return { text: en ? `It's under ${name}.` : `${name}と申します。` };
      if (name) return { text: en ? "I'm sorry, I can't give the name over the phone. Can you still take the booking?" : "申し訳ありません、名前はこの電話ではお伝えできないのですが、予約は可能でしょうか？", requestedAction: { action: "share_name", detail: `share name "${name}"` } };
      return { text: en ? "I'll give you the name later." : "予約者名は後ほどお伝えします。" };
    }

    // 3. Serial read-back.
    if (domain === "serial") {
      const pendingSerial = mission.pending.serial;
      if (typeof pendingSerial === "string") {
        return { text: `復唱いたします。${spellSerial(pendingSerial)}、でよろしいでしょうか？` };
      }
      if (mission.missing.includes("serial")) return { text: "恐れ入ります、もう一度シリアル番号をお願いできますでしょうか？" };
    }

    // 4. Evaluate pending offers from the callee against the contract.
    const pending = mission.pending;
    const pendingKeys = Object.keys(pending);
    if (pendingKeys.length > 0) {
      const check = checkConstraints(contract.constraints, { ...mission.verified, ...pending });
      const bad = new Set(check.violations.map((v) => v.field));
      // Date offered that differs from the requested date is not acceptable.
      if (date && typeof pending.date === "string" && pending.date !== date) bad.add("date");

      // A pending set with nothing violated is only acceptable when the price (if the mission
      // has a budget) is actually on the table; otherwise "はい、それでお願いします" would accept
      // a room whose price was just declined.
      // (a refusal clause never produces a pending offer — the evidence engine drops negative
      // clauses — so "19時は満席ですが、19時半は？" still lands here with time=19:30 pending)
      const priceUnknown = typeof budget === "number" && mission.verified.price === undefined && pending.price === undefined;
      if (bad.size === 0 && !priceUnknown) {
        // Accept, restating the most important value so the acceptance is explicit.
        const restate =
          typeof pending.time === "string" ? fmtTime(pending.time)
            : typeof pending.price === "number" ? jaPrice(pending.price)
              : undefined;
        if (en) return { text: restate ? `That works. Let's go with ${restate}, please.` : "That works, yes please." };
        return { text: restate ? `では、${restate}でお願いします。` : "はい、それでお願いします。" };
      }
      if (bad.has("time")) {
        this.altAsks++;
        if (this.altAsks > 2) return { text: en ? "Understood. We'll try another day. Thank you, goodbye." : "承知しました。では今回は見送らせていただきます。ありがとうございました。", action: "hangup" };
        if (en) {
          const rangeEn = after && before ? `between ${enTime(after)} and ${enTime(before)}` : after ? `${enTime(after)} or later` : before ? `before ${enTime(before)}` : "at another time";
          return { text: `Sorry, do you have anything ${rangeEn}?` };
        }
        const range = after && before ? `${jaTime(after)}から${jaTime(before)}の間` : after ? `${jaTime(after)}以降` : before ? `${jaTime(before)}まで` : "他の時間";
        return { text: `申し訳ありません、${range}で空いているお席はありますでしょうか？` };
      }
      if (bad.has("price") && typeof budget === "number") return this.counterPrice(domain, contract, budget);
      if (bad.has("date") && date) return { text: en ? `Sorry, I need ${enDate(date)}. Is that available?` : `恐れ入ります、${jaDate(date)}でお願いしたいのですが、空いておりますでしょうか？` };
      if (bad.has("breakfast")) return { text: "朝食付きでお願いすることはできますでしょうか？" };
      if (bad.has("smoking")) return { text: "禁煙のお部屋でお願いできますでしょうか？" };
    }

    // 5. Price above budget with no counter offer: negotiate or walk away.
    const knownPrice = (mission.verified.price ?? mission.pending.price) as number | undefined;
    if (typeof budget === "number" && typeof knownPrice === "number" && knownPrice > budget) {
      return this.counterPrice(domain, contract, budget);
    }
    if (REFUSAL_RE.test(lastText) && /値引|お値引き|安く|discount/.test(lastText)) {
      return { text: "承知しました。では今回は見送らせていただきます。ありがとうございました。", action: "hangup" };
    }

    // 5b. A hedge ("たぶん大丈夫", "確認します") is neither a yes nor a no: ask for a definite
    // answer (twice at most) instead of restating the request until the stall guard gives up.
    if (HEDGE_RE.test(lastText) && mission.missing.length > 0 && this.hedgeAsks < 2) {
      this.hedgeAsks++;
      const termsJa = [date ? jaDate(date) : "", after ? `${jaTime(after)}以降` : typeof input.time === "string" ? jaTime(input.time) : "", party ? `${party}名` : ""].filter(Boolean).join("、");
      const termsEn = [date ? enDate(date) : "", after ? `${enTime(after)} or later` : typeof input.time === "string" ? enTime(input.time) : "", party ? `party of ${party}` : ""].filter(Boolean).join(", ");
      if (this.hedgeAsks === 1) {
        return { text: en ? `Just to be sure: can you confirm the reservation${termsEn ? ` for ${termsEn}` : ""}, or is it still tentative?` : `念のため確認させてください。${termsJa ? `${termsJa}で` : ""}ご予約は確定とさせていただけますでしょうか？` };
      }
      return { text: en ? "Understood. Once you have checked, could you confirm it on this call?" : "承知しました。ご確認いただけましたら、この内容で確定をお願いできますでしょうか？" };
    }

    // 6. Callee refused the whole request (満席 etc.). Not when the same line re-offers a value we already
    //    hold ("7 pm is full, but we do have 7:30" said again after 7:30 was accepted): that is a repeat, not a refusal.
    const restatesVerified =
      (typeof mission.verified.time === "string" && parseTimes(lastText, en ? "en" : "ja").some((t) => t.value === mission.verified.time)) ||
      (typeof mission.verified.price === "number" && parsePrices(lastText).some((p) => p.value === mission.verified.price));
    if (REFUSAL_RE.test(lastText) && !AGREEMENT_RE.test(lastText) && pendingKeys.length === 0 && !restatesVerified) {
      if (/満席|満室|定休|以降は満席|在庫|fully booked|sold out|closed on/i.test(lastText)) {
        return { text: en ? "Understood, we'll try another day. Thank you, goodbye." : "承知しました。では別の日を検討いたします。ありがとうございました。", action: "hangup" };
      }
    }

    // 7. Answer the callee's questions from the contract input.
    // (in English a question mark is required: "party of 2 under Tanaka" is a restatement, not a question)
    const asksEn = (re: RegExp) => en && /\?/.test(lastText) && re.test(lastText);
    if ((en ? asksEn(/which date|what date|what day|when/i) : /日にち|お日にち|いつ|何日/.test(lastText)) && date) {
      return { text: en ? `${enDate(date)}, please.` : `${jaDate(date)}でお願いします。` };
    }
    if ((en ? asksEn(/how many|party size|number of (?:people|guests)/i) : /何名|人数|何人/.test(lastText)) && party) {
      return { text: en ? `${party} people.` : `${party}名です。` };
    }
    if (en ? asksEn(/what time|which time/i) : /何時|お時間|時間/.test(lastText)) {
      if (after) return { text: en ? `${enTime(after)} or later, if you have anything.` : `${jaTime(after)}以降でお願いしたいのですが、空いていますでしょうか？` };
      if (typeof input.time === "string") return { text: en ? `${enTime(input.time)}, please.` : `${jaTime(input.time)}でお願いします。` };
    }

    // 8. Everything required is verified except the confirmation: ask to finalise.
    if (mission.missing.length === 1 && mission.missing[0] === "confirmed" && mission.violations.length === 0) {
      // a yes/no question, so a plain 「はい、承知しました」 is a real answer (see isConfirmRequest)
      return { text: en ? "Great. Could you confirm the reservation, please?" : "では、その内容で予約をお願いします。ご予約を確定してもよろしいでしょうか？" };
    }

    // 9. Missing required fields: ask for them explicitly (price first when there is a budget;
    //    never re-ask something the callee has already put on the table).
    if (mission.missing.includes("price") && domain !== "restaurant" && pending.price === undefined) return { text: en ? "How much would that be?" : "料金はおいくらでしょうか？" };
    if (mission.missing.includes("breakfast") && pending.breakfast === undefined) return { text: en ? "Is breakfast included?" : "朝食は付いておりますでしょうか？" };
    if (mission.missing.includes("smoking") && pending.smoking === undefined) return { text: en ? "Do you have a non-smoking room?" : "禁煙のお部屋はございますか？" };
    if (mission.missing.includes("price") && domain !== "restaurant") return { text: en ? "How much would that be?" : "料金はおいくらでしょうか？" };

    // 10. Fallback: restate the request.
    return { text: this.opener(domain, contract) };
  }

  private counterPrice(domain: Domain, contract: CallContract, budget: number): BrainResponse {
    this.priceAttempts++;
    const qty = typeof contract.input.quantity === "number" ? contract.input.quantity : undefined;
    const wantsBreakfast = contract.constraints.breakfast?.eq === true;
    // walking away is a hang-up, not just a line — otherwise the call drifts on after the goodbye
    if (this.priceAttempts > 3) return { text: "承知しました。では今回は見送らせていただきます。ありがとうございました。", action: "hangup" };
    if (this.priceAttempts === 1) return { text: `予算が${jaPrice(budget)}なのですが、${jaPrice(budget)}以内になりませんでしょうか？` };
    if (this.priceAttempts === 2) {
      if (domain === "hotel" && wantsBreakfast) return { text: `朝食付きで${jaPrice(budget)}にしていただくことはできませんか？` };
      if (domain === "shop" && qty && qty > 1) return { text: `${qty}個まとめて購入しますので、1個${jaPrice(budget)}ではいかがでしょうか？` };
      return { text: `もう少しだけお安くなりませんか？${jaPrice(budget)}でしたら今日決めます。` };
    }
    return { text: `${jaPrice(budget)}が上限でして、それ以上ですと難しいのですが、いかがでしょうか？` };
  }

  private opener(domain: Domain, contract: CallContract): string {
    const input = contract.input as Record<string, unknown>;
    if (contract.language === "en") return this.openerEn(domain, contract);
    const date = typeof input.date === "string" ? jaDate(input.date) : "近日中";
    const party = typeof input.partySize === "number" ? `${input.partySize}名` : "";
    const after = contract.constraints.time?.gte;
    const time = typeof after === "string" ? `${jaTime(after)}以降` : typeof input.time === "string" ? jaTime(input.time) : "";
    switch (domain) {
      case "restaurant":
        return `恐れ入ります、${date}の${time}で${party}、予約をお願いしたいのですが、空いていますでしょうか？`;
      case "hotel": {
        const wants: string[] = [];
        if (contract.constraints.breakfast?.eq === true) wants.push("朝食付き");
        if (contract.constraints.smoking?.eq === false) wants.push("禁煙");
        return `恐れ入ります、${date}に${party}で宿泊を検討しておりまして、${wants.join("・")}${wants.length ? "の" : ""}お部屋の料金を伺えますでしょうか？`;
      }
      case "shop": {
        const item = typeof input.item === "string" ? input.item : "商品";
        const qty = typeof input.quantity === "number" ? `${input.quantity}個` : "";
        return `恐れ入ります、${item}を${qty}購入したいのですが、在庫と価格を教えていただけますか？`;
      }
      case "serial":
        return "恐れ入ります、製品のシリアル番号を教えていただけますでしょうか？";
      default:
        return "恐れ入ります、少々お伺いしたいことがあるのですが、よろしいでしょうか？";
    }
  }

  private openerEn(domain: Domain, contract: CallContract): string {
    const input = contract.input as Record<string, unknown>;
    const date = typeof input.date === "string" ? enDate(input.date) : "in the next few days";
    const party = typeof input.partySize === "number" ? `${input.partySize}` : "";
    const after = contract.constraints.time?.gte;
    const time = typeof after === "string" ? `${enTime(after)} or later` : typeof input.time === "string" ? enTime(input.time) : "";
    switch (domain) {
      case "restaurant":
        return `Hi, I'd like to book a table for ${party || "two"} on ${date}, ${time || "in the evening"}. Do you have anything available?`;
      case "hotel": {
        const wants: string[] = [];
        if (contract.constraints.breakfast?.eq === true) wants.push("with breakfast");
        if (contract.constraints.smoking?.eq === false) wants.push("non-smoking");
        return `Hi, I'm looking at ${date} for ${party || "two"} people. Could you tell me the rate for a ${wants.join(", ")} room?`;
      }
      case "shop": {
        const item = typeof input.item === "string" ? input.item : "the item";
        const qty = typeof input.quantity === "number" ? `${input.quantity} of ` : "";
        return `Hi, I'd like to buy ${qty}${item}. Do you have them in stock, and what's the price?`;
      }
      case "serial":
        return "Hi, could you give me the serial number of the unit, please?";
      default:
        return "Hi, I'm calling about a reservation.";
    }
  }
}
