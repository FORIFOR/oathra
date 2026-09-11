import { ACCEPTANCE_RE, parseDates, parsePartySize, parsePrices } from "@oathra/evidence";
import type { Scenario } from "@oathra/scenario";
import { extractName, GOODBYE_RE, jaDate, jaPrice, type CalleeCharacter, type CalleeContext, type CalleeReply } from "../character.js";

type Knowledge = {
  standard_price: number;
  minimum_price: number;
  /** 0 means breakfast is included / free to bundle. */
  breakfast_price?: number;
  non_smoking_available?: boolean;
  require_name?: boolean;
  now?: string;
};

/**
 * Hotel front desk that negotiates. Never reveals minimum_price, concedes
 * in decreasing steps proportional to persona.flexibility, bundles breakfast
 * when asked, and gets firm once pushbacks exceed persona.patience.
 */
export class HotelCharacter implements CalleeCharacter {
  readonly name: string;
  private readonly k: Knowledge;
  private readonly now: Date;
  private readonly flexibility: number;
  private readonly patience: number;
  private readonly bundleBreakfast: boolean;
  private date?: string;
  private party?: number;
  private guestName?: string;
  private current: number;
  private offered: number | undefined;
  private breakfast = false;
  private pushbacks = 0;
  private quoted = false;
  private askedName = false;
  private confirmed = false;

  constructor(private readonly scenario: Scenario) {
    this.name = scenario.callee.persona.name;
    const k = scenario.callee.knowledge as Partial<Knowledge>;
    this.k = {
      standard_price: k.standard_price ?? 23500,
      minimum_price: k.minimum_price ?? 18800,
      breakfast_price: k.breakfast_price ?? 0,
      non_smoking_available: k.non_smoking_available ?? true,
      require_name: k.require_name ?? true,
    };
    this.now = k.now ? new Date(k.now) : new Date();
    this.current = this.k.standard_price;
    this.flexibility = scenario.callee.persona.flexibility;
    this.patience = scenario.callee.persona.patience;
    this.bundleBreakfast = scenario.callee.rules.some((r) => /breakfast may be bundled|朝食.*(?:付け|同梱)/i.test(r));
  }

  greeting(): string {
    return this.scenario.callee.greeting ?? `お電話ありがとうございます、${this.name}フロントでございます。`;
  }

  private roomDesc(): string {
    return `${this.breakfast ? "朝食付き" : ""}禁煙${this.breakfast ? "の" : ""}お部屋`;
  }

  respond(ctx: CalleeContext): CalleeReply {
    const text = ctx.lastAgentText;
    const dates = parseDates(text, this.now, ctx.language).map((d) => d.value);
    const parties = parsePartySize(text, ctx.language).map((p) => p.value);
    const prices = parsePrices(text).map((p) => p.value);
    if (dates[0]) this.date = dates[0];
    if (parties[0]) this.party = parties[0];
    const wantsBreakfast = /朝食/.test(text);
    const wantsNonSmoking = /禁煙/.test(text);

    if (GOODBYE_RE.test(text) && !/[?？]/.test(text)) {
      return { text: this.confirmed ? "お待ちしております。失礼いたします。" : "承知いたしました。ご検討のほどよろしくお願いいたします。", hangup: true };
    }

    if (this.askedName && !this.guestName) {
      const n = extractName(text);
      if (n) {
        this.guestName = n;
        return this.confirm();
      }
    }

    // Accepting the current offer.
    const accepts = ACCEPTANCE_RE.test(text) && !/になりません|できません|お安く|割引|値引/.test(text);
    if (this.quoted && accepts && (prices.length === 0 || prices.includes(this.offered ?? this.current))) {
      if (this.offered !== undefined) this.current = this.offered;
      this.offered = undefined;
      return this.settle();
    }

    // Price negotiation: a budget or an explicit discount request.
    const budget = prices[0];
    const asksDiscount = /安く|割引|値引|予算|以内|以下|になりません|discount|cheaper|budget/i.test(text);
    if (this.quoted && (asksDiscount || (budget !== undefined && budget < this.current))) {
      if (wantsBreakfast && this.bundleBreakfast) this.breakfast = true;
      if (budget !== undefined && budget >= this.current) {
        return { text: `はい、${jaPrice(this.current)}で大丈夫です。` };
      }
      this.pushbacks++;
      if (this.pushbacks > Math.max(1, Math.round(this.patience * 4))) {
        return { text: "申し訳ございません、これ以上のお値引きは難しいです。" };
      }
      // Concede from the last offer, not from the list price, so repeated
      // pushbacks move the price instead of repeating the same number.
      const base = this.offered ?? this.current;
      const gap = base - this.k.minimum_price;
      const step = Math.ceil((gap * (0.35 + 0.45 * this.flexibility)) / 100) * 100;
      let next = Math.max(this.k.minimum_price, base - step);
      // "discount only when justified": meet a budget inside our floor only
      // when the caller gives a reason (breakfast bundle, multiple nights,
      // deciding today) or has already pushed back once.
      const justified = /朝食|連泊|まとめ|今日決め|即決|複数|bundle|tonight|decide today/i.test(text) || this.pushbacks >= 2;
      if (budget !== undefined && budget >= this.k.minimum_price && budget < next && justified) {
        next = Math.floor(budget / 100) * 100;
        this.offered = next;
        this.quoted = true;
        return { text: `かしこまりました。${this.breakfast ? "朝食付きで" : ""}${jaPrice(next)}で承ります。` };
      }
      if (next >= base) {
        return { text: "申し訳ございません、これ以上のお値引きは難しいです。" };
      }
      this.offered = next;
      const bundle = this.breakfast ? "朝食をお付けして" : "";
      return { text: `${bundle}${jaPrice(next)}でしたらご案内できます。いかがでしょうか？` };
    }

    // Initial inquiry / quote.
    if (/料金|いくら|値段|価格|price|rate|cost|空い|予約|泊/.test(text) || this.date || this.party) {
      if (!this.date) return { text: "ご宿泊のお日にちはいつでしょうか？" };
      if (!this.party) return { text: "何名様でのご宿泊でしょうか？" };
      if (wantsBreakfast && (this.k.breakfast_price === 0 || this.bundleBreakfast)) this.breakfast = true;
      if (wantsNonSmoking && !this.k.non_smoking_available) {
        return { text: "申し訳ございません、禁煙のお部屋は満室でございます。" };
      }
      this.quoted = true;
      const bf = this.breakfast
        ? "朝食付きで"
        : this.k.breakfast_price && wantsBreakfast
          ? `朝食は別途${jaPrice(this.k.breakfast_price)}で、`
          : "";
      return {
        text: `${jaDate(this.date)}、${this.party}名様ですね。禁煙のお部屋でしたらご用意できます。${bf}1泊${jaPrice(this.current)}でございます。`,
      };
    }

    if (/朝食|breakfast/i.test(text)) {
      if (this.breakfast) return { text: "はい、朝食は付いております。" };
      if (this.k.breakfast_price === 0) {
        this.breakfast = true;
        return { text: "はい、朝食は付いております。" };
      }
      return { text: `朝食は別途${jaPrice(this.k.breakfast_price ?? 0)}でございます。` };
    }

    return { text: "恐れ入ります、もう一度お願いできますでしょうか？" };
  }

  truth(): Record<string, unknown> {
    return this.confirmed
      ? { confirmed: true, date: this.date, partySize: this.party, price: this.current, breakfast: this.breakfast, smoking: false, name: this.guestName }
      : { confirmed: false };
  }

  private settle(): CalleeReply {
    if (this.k.require_name && !this.guestName) {
      this.askedName = true;
      return { text: "かしこまりました。ご予約者様のお名前をお伺いしてもよろしいでしょうか？" };
    }
    return this.confirm();
  }

  private confirm(): CalleeReply {
    if (!this.date || !this.party) return { text: "恐れ入ります、ご宿泊日と人数をお伺いできますでしょうか？" };
    this.confirmed = true;
    const who = this.guestName ? `${this.guestName}様、` : "";
    return {
      text: `かしこまりました。${jaDate(this.date)}、${this.party}名様、${who}${this.roomDesc()}、1泊${jaPrice(this.current)}でご予約承りました。`,
    };
  }
}
