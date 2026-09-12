import { ACCEPTANCE_RE, parseDates, parsePartySize, parseTimes } from "@oathra/evidence";
import type { Scenario } from "@oathra/scenario";
import { enDate, enTime, extractName, GOODBYE_RE, jaDate, jaTime, NAME_ASK_RE, type CalleeCharacter, type CalleeContext, type CalleeReply } from "../character.js";

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
 * "ご予約承りました" / "you're all set" once all details (and the name, if
 * required) are settled. Speaks Japanese or English per the scenario.
 */
export class RestaurantCharacter implements CalleeCharacter {
  readonly name: string;
  private readonly k: Knowledge;
  private readonly now: Date;
  private readonly patience: number;
  private readonly en: boolean;
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
    this.en = scenario.language === "en";
  }

  greeting(): string {
    return this.scenario.callee.greeting ?? (this.en ? `Thank you for calling ${this.name}, how can I help you?` : `お電話ありがとうございます、${this.name}でございます。`);
  }

  private fmtTime(hhmm: string): string {
    return this.en ? enTime(hhmm) : jaTime(hhmm);
  }
  private fmtDate(iso: string): string {
    return this.en ? enDate(iso) : jaDate(iso);
  }
  private t(ja: string, en: string): string {
    return this.en ? en : ja;
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
      return {
        text: this.confirmed
          ? this.t("お待ちしております。失礼いたします。", "We look forward to seeing you. Goodbye.")
          : this.t("承知いたしました。またのお電話をお待ちしております。", "Understood. Thank you for calling, goodbye."),
        hangup: true,
      };
    }

    // Name answer
    if (this.askedName && !this.guestName) {
      const n = extractName(text);
      if (n) {
        this.guestName = n;
        return this.confirm();
      }
      if (!NAME_ASK_RE.test(text) && times.length === 0) {
        return { text: this.t("恐れ入ります、お名前をもう一度お願いできますでしょうか？", "Sorry, could I have the name once more?") };
      }
    }

    // Accepting an offer ("19時半でお願いします" / "that works, 7:30 please")
    const accepts = ACCEPTANCE_RE.test(text);
    if (this.offered && accepts && (times.length === 0 || times.includes(this.offered))) {
      this.time = this.offered;
      this.offered = undefined;
      return this.settle();
    }

    // Threshold request: "19時以降で空いていますか" / "7 pm or later"
    const afterJa = /(\d{1,2}(?::\d{2})?時?(?:半)?)\s*(?:以降|以後|から|より後)/.exec(text);
    const afterEn = times.length > 0 && /\b(?:or later|after|onwards|from)\b/i.test(text);
    const afterMatch = Boolean(afterJa || afterEn);
    const requestedTime = times[0];

    if (requestedTime || afterMatch) {
      if (this.date && this.k.closed_dates?.includes(this.date)) {
        return { text: this.t(`申し訳ございません、${jaDate(this.date)}は定休日をいただいております。`, `I'm sorry, we're closed on ${enDate(this.date)}.`) };
      }
      if (!this.party) return { text: this.t("何名様でしょうか？", "For how many people?") };
      if (!this.date) return { text: this.t("ご希望のお日にちはいつでしょうか？", "Which date would you like?") };
      if (this.party > (this.k.max_party ?? 8)) {
        return { text: this.t(`申し訳ございません、最大${this.k.max_party}名様までのご案内となっております。`, `I'm sorry, we can only seat parties of up to ${this.k.max_party}.`) };
      }
      const wanted = requestedTime ?? "00:00";
      if (afterMatch && !this.open(wanted, this.party)) {
        // "after X": offer the nearest open slot at or after X
        const alt = this.nearestOpen(wanted, this.party, this.offered);
        if (alt && alt >= wanted) {
          this.offered = alt;
          return { text: this.t(`${jaTime(wanted)}はいっぱいですが、${jaTime(alt)}でしたら空いております。いかがでしょうか？`, `${enTime(wanted)} is fully booked, but we do have ${enTime(alt)}. Would that work?`) };
        }
        return { text: this.t(`申し訳ございません、${jaTime(wanted)}以降は満席でございます。`, `I'm sorry, we're fully booked from ${enTime(wanted)} onwards.`) };
      }
      if (this.open(wanted, this.party)) {
        this.time = wanted;
        this.offered = undefined;
        const base = this.t(`${jaDate(this.date)}の${jaTime(wanted)}、${this.party}名様ですね。はい、空いております。`, `${enDate(this.date)} at ${enTime(wanted)} for ${this.party}. Yes, we have that available.`);
        if (this.k.require_name && !this.guestName) {
          this.askedName = true;
          return { text: this.t(`${base}お名前をお伺いしてもよろしいでしょうか？`, `${base} May I have a name for the reservation?`) };
        }
        return this.confirm(base);
      }
      this.fullAsks++;
      const alt = this.nearestOpen(wanted, this.party, this.offered);
      if (!alt) return { text: this.t(`申し訳ございません、${jaDate(this.date)}は満席でございます。`, `I'm sorry, we're fully booked on ${enDate(this.date)}.`) };
      this.offered = alt;
      const tone = this.fullAsks > this.patience * 4 ? "" : this.t("申し訳ございません、", "I'm sorry, ");
      return { text: this.t(`${tone}${jaTime(wanted)}はいっぱいですが、${jaTime(alt)}でしたら空いております。いかがでしょうか？`, `${tone}${enTime(wanted)} is fully booked, but we do have ${enTime(alt)}. Would that work?`) };
    }

    // Partial request without time
    if (this.date || this.party) {
      if (!this.date) return { text: this.t("ご希望のお日にちはいつでしょうか？", "Which date would you like?") };
      if (!this.party) return { text: this.t("何名様でしょうか？", "For how many people?") };
      if (!this.time) return { text: this.t("ご希望のお時間は何時ごろでしょうか？", "What time would you like?") };
      return this.settle();
    }

    if (/予約|席|空い|reserv|table|book/i.test(text)) {
      return { text: this.t("ご予約ですね。ご希望のお日にちはいつでしょうか？", "A reservation, certainly. Which date would you like?") };
    }
    return { text: this.t("恐れ入ります、もう一度お願いできますでしょうか？", "Sorry, could you say that again?") };
  }

  truth(): Record<string, unknown> {
    return this.confirmed
      ? { confirmed: true, date: this.date, time: this.time, partySize: this.party, name: this.guestName }
      : { confirmed: false };
  }

  private settle(): CalleeReply {
    if (this.k.require_name && !this.guestName) {
      this.askedName = true;
      return { text: this.t("かしこまりました。お名前をお伺いしてもよろしいでしょうか？", "Certainly. May I have a name for the reservation?") };
    }
    return this.confirm();
  }

  private confirm(prefix?: string): CalleeReply {
    if (!this.date || !this.time || !this.party) {
      return { text: this.t("恐れ入ります、ご希望のお日にちとお時間、人数をお伺いできますでしょうか？", "Could I have the date, time and number of people, please?") };
    }
    this.confirmed = true;
    if (this.en) {
      const who = this.guestName ? ` under ${this.guestName}` : "";
      return { text: `${prefix ?? "Perfect."} ${enDate(this.date)} at ${enTime(this.time)}, party of ${this.party}${who} — you're all set. We'll see you then.` };
    }
    const who = this.guestName ? `${this.guestName}様で` : "";
    return { text: `${prefix ?? "かしこまりました。"}${jaDate(this.date)}${jaTime(this.time)}、${this.party}名様、${who}ご予約承りました。当日お待ちしております。` };
  }
}
