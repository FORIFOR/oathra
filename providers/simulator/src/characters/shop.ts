import { ACCEPTANCE_RE, kanjiToNumber, parsePrices } from "@oathra/evidence";
import type { Scenario } from "@oathra/scenario";
import { GOODBYE_RE, jaPrice, type CalleeCharacter, type CalleeContext, type CalleeReply } from "../character.js";

type Knowledge = {
  item: string;
  list_price: number;
  minimum_price: number;
  /** Quantity from which the bulk floor applies. */
  bulk_qty?: number;
  bulk_minimum_price?: number;
  stock?: number;
};

/**
 * Shop clerk selling one item. The caller (agent) tries to buy under budget;
 * the clerk holds a per-unit floor that drops for bulk orders.
 */
export class ShopCharacter implements CalleeCharacter {
  readonly name: string;
  private readonly k: Knowledge;
  private readonly flexibility: number;
  private readonly patience: number;
  private current: number;
  private offered: number | undefined;
  private qty = 1;
  private quoted = false;
  private pushbacks = 0;
  private confirmed = false;

  constructor(private readonly scenario: Scenario) {
    this.name = scenario.callee.persona.name;
    const k = scenario.callee.knowledge as Partial<Knowledge>;
    this.k = {
      item: k.item ?? "商品",
      list_price: k.list_price ?? 8000,
      minimum_price: k.minimum_price ?? 6000,
      bulk_qty: k.bulk_qty ?? 3,
      bulk_minimum_price: k.bulk_minimum_price ?? k.minimum_price ?? 6000,
      stock: k.stock ?? 10,
    };
    this.current = this.k.list_price;
    this.flexibility = scenario.callee.persona.flexibility;
    this.patience = scenario.callee.persona.patience;
  }

  greeting(): string {
    return this.scenario.callee.greeting ?? `お電話ありがとうございます、${this.name}です。`;
  }

  truth(): Record<string, unknown> {
    return this.confirmed ? { confirmed: true, price: this.current, quantity: this.qty } : { confirmed: false };
  }

  private floor(): number {
    return this.qty >= (this.k.bulk_qty ?? 3) ? (this.k.bulk_minimum_price ?? this.k.minimum_price) : this.k.minimum_price;
  }

  respond(ctx: CalleeContext): CalleeReply {
    const text = ctx.lastAgentText;
    const prices = parsePrices(text).map((p) => p.value);
    const qtyMatch = /(\d{1,3}|[一二三四五六七八九十]{1,3})\s*(?:個|点|つ|セット)/.exec(text);
    if (qtyMatch) this.qty = kanjiToNumber(qtyMatch[1]!) ?? this.qty;

    if (GOODBYE_RE.test(text) && !/[?？]/.test(text)) {
      return { text: this.confirmed ? "ありがとうございます。失礼いたします。" : "承知いたしました。またのご利用をお待ちしております。", hangup: true };
    }

    const accepts = ACCEPTANCE_RE.test(text) && !/になりません|できません|安く|割引|値引/.test(text);
    if (this.quoted && accepts && (prices.length === 0 || prices.includes(this.offered ?? this.current))) {
      if (this.offered !== undefined) this.current = this.offered;
      this.offered = undefined;
      this.confirmed = true;
      return { text: `かしこまりました。${this.k.item}${this.qty}個、1個${jaPrice(this.current)}でご注文承りました。` };
    }

    const budget = prices[0];
    const asksDiscount = /安く|割引|値引|予算|以内|以下|になりません|まとめ|discount|cheaper|budget|bulk/i.test(text);
    if (this.quoted && (asksDiscount || (budget !== undefined && budget < this.current))) {
      if (budget !== undefined && budget >= this.current) return { text: `はい、1個${jaPrice(this.current)}で大丈夫です。` };
      this.pushbacks++;
      if (this.pushbacks > Math.max(1, Math.round(this.patience * 4))) {
        return { text: "申し訳ございません、これ以上のお値引きはできません。" };
      }
      const floor = this.floor();
      if (budget !== undefined && budget >= floor) {
        const next = Math.floor(budget / 100) * 100;
        this.offered = next;
        return { text: `${this.qty >= (this.k.bulk_qty ?? 3) ? `${this.qty}個まとめてでしたら、` : ""}1個${jaPrice(next)}でお出しできます。` };
      }
      const base = this.offered ?? this.current;
      const gap = base - floor;
      const step = Math.ceil((gap * (0.3 + 0.5 * this.flexibility)) / 100) * 100;
      const next = Math.max(floor, base - step);
      if (next >= base) return { text: "申し訳ございません、これ以上のお値引きはできません。" };
      this.offered = next;
      return { text: `${this.qty >= (this.k.bulk_qty ?? 3) ? `${this.qty}個まとめてでしたら、` : ""}1個${jaPrice(next)}でいかがでしょうか？` };
    }

    if (/いくら|値段|価格|料金|在庫|あります|欲しい|購入|買い|price|cost|buy|stock/i.test(text) || qtyMatch) {
      if ((this.k.stock ?? 0) < this.qty) return { text: `申し訳ございません、${this.k.item}は在庫が${this.k.stock}個しかございません。` };
      this.quoted = true;
      return { text: `${this.k.item}ですね。在庫ございます。1個${jaPrice(this.current)}でございます。` };
    }
    return { text: "恐れ入ります、もう一度お願いできますでしょうか？" };
  }
}
