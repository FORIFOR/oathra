import { ACCEPTANCE_RE, parseDates, parsePartySize, parseTimes } from "@oathra/evidence";
import type { Scenario } from "@oathra/scenario";
import { extractName, GOODBYE_RE, jaDate, jaTime, NAME_ASK_RE, type CalleeCharacter, type CalleeContext, type CalleeReply } from "../character.js";

type Knowledge = {
  availability: Record<string, number>;
  closed_dates?: string[];
  max_party?: number;
  require_name?: boolean;
  now?: string;
};

/**
 * Restaurant reception. Deterministic. Knows a table of availability per
 * time slot, asks for missing details in a fixed order (date, party, time),
 * offers the nearest alternative when a slot is full, and only ever says
 * "ご予約承りました" once all details (and the name, if required) are settled.
 */
export class RestaurantCharacter implements CalleeCharacter {
  readonly name: string;
  private readonly k: Knowledge;
  private readonly now: Date;
  private readonly patience: number;
  private date?: string;
  private time?: string;
  private party?: number;
  private guestName?: string;
  private offered: string | undefined;
  private askedName = false;
  private confirmed = false;
  private fullAsks = 0;

  constructor(private readonly scenario: Scenario) {
    this.name = scenario.callee.persona.name;
    const k = scenario.callee.knowledge as Partial<Knowledge>;
    this.k = {
      availability: k.availability ?? { "18:00": 2, "19:00": 0, "19:30": 1, "20:00": 3 },
      ...(k.closed_dates ? { closed_dates: k.closed_dates } : {}),
      max_party: k.max_party ?? 8,
      require_name: k.require_name ?? true,
    };
    this.now = k.now ? new Date(k.now) : new Date();
    this.patience = scenario.callee.persona.patience;
  }

  greeting(): string {
    return this.scenario.callee.greeting ?? `お電話ありがとうございます、${this.name}でございます。`;
  }

  private slots(): string[] {
    return Object.keys(this.k.availability).sort();
  }

  private open(time: string, party: number): boolean {
    const n = this.k.availability[time];
    return n !== undefined && n > 0 && party <= (this.k.max_party ?? 8);
  }

  private nearestOpen(after: string, party: number, exclude?: string): string | undefined {
    const later = this.slots().filter((s) => s >= after && s !== exclude && this.open(s, party));
    if (later.length) return later[0];
    const earlier = this.slots().filter((s) => s < after && s !== exclude && this.open(s, party)).reverse();
    return earlier[0];
  }

  respond(ctx: CalleeContext): CalleeReply {
    const text = ctx.lastAgentText;
    const times = parseTimes(text, ctx.language).map((t) => t.value);
    const dates = parseDates(text, this.now, ctx.language).map((d) => d.value);
    const parties = parsePartySize(text, ctx.language).map((p) => p.value);

    if (dates[0]) this.date = dates[0];
    if (parties[0]) this.party = parties[0];

    // Goodbye
    if (GOODBYE_RE.test(text) && !/[?？]/.test(text)) {
      return { text: this.confirmed ? "お待ちしております。失礼いたします。" : "承知いたしました。またのお電話をお待ちしております。", hangup: true };
    }

    // Name answer
    if (this.askedName && !this.guestName) {
      const n = extractName(text);
      if (n) {
        this.guestName = n;
        return this.confirm();
      }
      if (!NAME_ASK_RE.test(text) && times.length === 0) {
        return { text: "恐れ入ります、お名前をもう一度お願いできますでしょうか？" };
      }
    }

    // Accepting an offer ("19時半でお願いします" / "それでお願いします")
    const accepts = ACCEPTANCE_RE.test(text);
    if (this.offered && accepts && (times.length === 0 || times.includes(this.offered))) {
      this.time = this.offered;
      this.offered = undefined;
      return this.settle();
    }

    // Threshold request: "19時以降で空いていますか"
    const afterMatch = /(\d{1,2}(?::\d{2})?時?(?:半)?)\s*(?:以降|以後|から|より後|or later|after)/.exec(text);
    const requestedTime = times[0];

    if (requestedTime || afterMatch) {
      if (this.date && this.k.closed_dates?.includes(this.date)) {
        return { text: `申し訳ございません、${jaDate(this.date)}は定休日をいただいております。` };
      }
      if (!this.party) return { text: "何名様でしょうか？" };
      if (!this.date) return { text: "ご希望のお日にちはいつでしょうか？" };
      if (this.party > (this.k.max_party ?? 8)) {
        return { text: `申し訳ございません、最大${this.k.max_party}名様までのご案内となっております。` };
      }
      const wanted = requestedTime ?? "00:00";
      if (afterMatch && !this.open(wanted, this.party)) {
        // "after X": offer the nearest open slot at or after X
        const alt = this.nearestOpen(wanted, this.party, this.offered);
        if (alt && alt >= wanted) {
          this.offered = alt;
          return { text: `${jaTime(wanted)}はいっぱいですが、${jaTime(alt)}でしたら空いております。いかがでしょうか？` };
        }
        return { text: `申し訳ございません、${jaTime(wanted)}以降は満席でございます。` };
      }
      if (this.open(wanted, this.party)) {
        this.time = wanted;
        this.offered = undefined;
        const base = `${jaDate(this.date)}の${jaTime(wanted)}、${this.party}名様ですね。はい、空いております。`;
        if (this.k.require_name && !this.guestName) {
          this.askedName = true;
          return { text: `${base}お名前をお伺いしてもよろしいでしょうか？` };
        }
        return this.confirm(base);
      }
      this.fullAsks++;
      const alt = this.nearestOpen(wanted, this.party, this.offered);
      if (!alt) return { text: `申し訳ございません、${jaDate(this.date)}は満席でございます。` };
      this.offered = alt;
      const tone = this.fullAsks > this.patience * 4 ? "" : "申し訳ございません、";
      return { text: `${tone}${jaTime(wanted)}はいっぱいですが、${jaTime(alt)}でしたら空いております。いかがでしょうか？` };
    }

    // Partial request without time
    if (this.date || this.party) {
      if (!this.date) return { text: "ご希望のお日にちはいつでしょうか？" };
      if (!this.party) return { text: "何名様でしょうか？" };
      if (!this.time) return { text: "ご希望のお時間は何時ごろでしょうか？" };
      return this.settle();
    }

    if (/予約|席|空い|reserv|table|book/i.test(text)) {
      return { text: "ご予約ですね。ご希望のお日にちはいつでしょうか？" };
    }
    return { text: "恐れ入ります、もう一度お願いできますでしょうか？" };
  }

  truth(): Record<string, unknown> {
    return this.confirmed
      ? { confirmed: true, date: this.date, time: this.time, partySize: this.party, name: this.guestName }
      : { confirmed: false };
  }

  private settle(): CalleeReply {
    if (this.k.require_name && !this.guestName) {
      this.askedName = true;
      return { text: "かしこまりました。お名前をお伺いしてもよろしいでしょうか？" };
    }
    return this.confirm();
  }

  private confirm(prefix = "かしこまりました。"): CalleeReply {
    if (!this.date || !this.time || !this.party) return { text: "恐れ入ります、ご希望のお日にちとお時間、人数をお伺いできますでしょうか？" };
    this.confirmed = true;
    const who = this.guestName ? `${this.guestName}様で` : "";
    return {
      text: `${prefix}${jaDate(this.date)}${jaTime(this.time)}、${this.party}名様、${who}ご予約承りました。当日お待ちしております。`,
    };
  }
}
