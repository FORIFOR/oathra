/**
 * EvidenceEngine: ingests utterances, maintains the evidence graph and
 * decides deterministically which claims are verified.
 *
 * Verification rules (v0.1):
 *  - A value offered by the callee becomes verified when the caller accepts
 *    it in the next caller turn (acceptance phrase, and either no value or
 *    the same value restated).
 *  - A value proposed by the caller becomes verified when the callee agrees
 *    in the next callee turn (agreement phrase, and either no value or the
 *    same value restated).
 *  - `confirmed` is verified ONLY from an explicit callee
 *    confirmation phrase. The caller saying "予約できました" is never evidence.
 *  - A later claim on the same field by the same side supersedes the earlier
 *    one (pending claims only; verified evidence is kept in history).
 *  - Whatever the callee says settles something only when the WHOLE utterance is one of the settling
 *    shapes in shape.ts (acknowledgement, the terms restated, a commit; nothing else beside them). The
 *    phrase rules above are necessary, never sufficient. A reply that restates nothing answers the last
 *    question of the caller's previous turn, and settles the terms only when that question was the proposal.
 *  - After a settlement, a later callee utterance that doubts it, points at the terms, or (appointment
 *    mode) says anything that is not a settling shape, a question or a goodbye takes `confirmed` back.
 */
import { extractClaims, isAcceptance, isAgreement, isConfirmRequest, type Claim, CALLEE_COMMIT_RE, CONTRAST_RE, HEDGE_RE, HOLD_RE, OTHER_MATTER_RE, QUESTION_RE, REFUSAL_RE, RETRACTION_RE, TERMS_RE, UNABLE_RE, UNAVAILABLE_RE } from "./extract.js";
import { calleeShape, callerAsk, confirmationFits, normalizeSpeech, restatedInFittingSentences, shapeSettles, trailsOff, unsettles, type AskKind } from "./shape.js";
import type { Evidence, EvidenceEdge, EvidenceGraph, Language, Speaker, Utterance } from "./types.js";

/**
 * Who settles `confirmed`.
 *  - "callee_statement" (default): only an explicit confirmation phrase from the callee
 *    (a shop saying 「ご予約承りました」).
 *  - "callee_acceptance": appointment-style calls where the caller proposes a slot and the
 *    callee commits to it (「はい、9月25日の15時でお願いします」). The commitment counts only when
 *    it is clean (no hedge, refusal, contrast or question) and the whole slot (date and time)
 *    is stated in that utterance or already settled.
 */
export type ConfirmationMode = "callee_statement" | "callee_acceptance";

export type EngineOptions = {
  now?: Date;
  language?: Language;
  idFactory?: () => string;
  confirmation?: ConfirmationMode;
};

export type IngestResult = {
  created: Evidence[];
  verified: Evidence[];
};

const squash = (s: string) => s.normalize("NFKC").replace(/[\s、。，．,.!?！？「」…]/g, "");

/**
 * The older phrase rules, kept as REFUSALS only. They used to demand one of a short list of agreement words as
 * well; which words agree is now decided by the shapes (shape.ts), so 「いいですよ」「わかりました」「お受けします」
 * settle, while a hedge, a refusal, a contrast, a hold or a question anywhere in the utterance still settles nothing.
 */
const agreementClean = (t: string) => !REFUSAL_RE.test(t) && !HEDGE_RE.test(t) && !QUESTION_RE.test(t.trim());
// (「…とさせていただきます」 is not the contrast 「ただ」, and 「会議室でお待ちしております」 is not 「会議です」.)
const commitClean = (t: string) =>
  !REFUSAL_RE.test(t) && !HEDGE_RE.test(t) && !CONTRAST_RE.test(t.replace(/いただ/g, "")) && !RETRACTION_RE.test(t) && !HOLD_RE.test(t) &&
  !/[?？]|でしょうか|ですか|ますか|ませんか/.test(t) && !UNABLE_RE.test(t.replace(/会議室/g, "")) && (CALLEE_COMMIT_RE.test(t) || !(OTHER_MATTER_RE.test(t) && !TERMS_RE.test(t)));
const WEEKDAYS = "日月火水木金土";

function valuesEqual(a: unknown, b: unknown): boolean {
  return a === b || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-9);
}

export class EvidenceEngine {
  private readonly nodes: Evidence[] = [];
  private readonly edges: EvidenceEdge[] = [];
  /** Latest unverified claim per field from the callee (offer). */
  private pendingOffers = new Map<string, Evidence>();
  /** Latest unverified claim per field from the caller (proposal). */
  private pendingProposals = new Map<string, Evidence>();
  /** The caller asked "shall I confirm?" and the callee has not answered yet. */
  private pendingConfirmRequest: Utterance | undefined;
  private readonly now: Date;
  private readonly language: Language;
  private readonly idFactory: () => string;
  private readonly confirmation: ConfirmationMode;
  /** The caller utterance immediately before the current one (appointment mode: a bare 「はい」 answers only that). */
  private lastCallerUtteranceId: string | undefined;
  /** What the caller's last turn asked (shape.ts `callerAsk`): a reply that restates nothing answers only this. */
  private lastAsk: AskKind = "none";
  /** The caller's last words, to recognise the line echoing them back as the callee. */
  private lastCallerText = "";
  /** The callee has said something that is not a settling shape since the caller last spoke. */
  private interrupted = false;
  /** Everything the caller has said, squashed: a product or a name the callee puts among the terms must be in here. */
  private callerSaid = "";
  /** The callee's previous utterance when it stopped mid-sentence and the caller has not spoken since. */
  private unfinished: string | undefined;
  /** The utterance being ingested, as it was heard: evidence quotes this, never the normalised reading. */
  private heard = "";
  /** The caller's last turn asked for the booking itself (「…で予約をお願いしたいのですが」), not whether there is room. */
  private bookingAsked = false;
  /** A confirmation rests on a future form (1b''): later callee words are held to the strict rule of `unsettles`. */
  private promised = false;
  /** The latest value the caller has put forward for each field. */
  private callerProposed = new Map<string, unknown>();
  private seq = 0;

  constructor(opts: EngineOptions = {}) {
    this.now = opts.now ?? new Date();
    this.language = opts.language ?? "ja";
    this.idFactory = opts.idFactory ?? (() => `ev_${++this.seq}`);
    this.confirmation = opts.confirmation ?? "callee_statement";
  }

  /** Time of the latest callee retraction (「やはりお取りできませんでした」); a confirmation before it no longer counts. */
  private retractedAt: number | undefined;

  ingest(u: Utterance): IngestResult {
    if (u.source === "callee" && RETRACTION_RE.test(u.text)) this.retractedAt = u.t;
    // The slot is gone (「その日は貸切でした」「満席になってしまいました」). Only a confirmation spoken strictly
    // earlier is revoked, so the ordinary 「19時は満席ですが19時半なら」 before a booking is unaffected.
    if (u.source === "callee" && UNAVAILABLE_RE.test(u.text)) this.retractedAt = u.t;
    // Appointment mode: 「はい。」 followed by 「あ、その日は出張でした」 or 「上司に聞いてからでないと…」.
    // A commitment is a person's word, so a later refusal or hedge from the same person takes it back;
    // the agent has to ask again. (A shop's 「ご予約承りました」 is a record and keeps the stricter rule above.)
    if (this.confirmation === "callee_acceptance" && u.source === "callee" && (REFUSAL_RE.test(u.text) || HEDGE_RE.test(u.text))) this.retractedAt = u.t;
    const created: Evidence[] = [];
    const verifiedNow: Evidence[] = [];
    const opts = { now: this.now, language: u.language ?? this.language };
    // The whole-utterance shape (shape.ts). A callee utterance settles only when every clause of it is an
    // acknowledgement, the terms, or a commit; the older phrase rules (isAgreement, isCalleeCommitment,
    // isAffirmativeAnswer) still have to agree, so nothing they refused can settle now.
    // An utterance that continues one left hanging (「10月5日の15時で」+「はちょっと…」) is read together with it.
    this.heard = u.text;
    // Kana spellings of the agreement vocabulary and missing punctuation are put back before anything is read.
    if (u.source === "callee") u = { ...u, text: normalizeSpeech(u.text) };
    const hanging = u.source === "callee" ? this.unfinished : undefined;
    const shape = u.source === "callee" ? calleeShape((hanging ?? "") + u.text, opts) : undefined;
    // The line playing the caller's own words back (speech recognition on a leaky channel) is not the callee.
    const echoed = u.source === "callee" && squash(u.text).length > 0 && squash(this.lastCallerText).includes(squash(u.text)) && squash(u.text).length >= 10;
    // 「A-200を50ケース…で承りました」 when the caller asked for A-100: another product is another deal.
    // (With no caller words at all there is nothing to compare against.)
    const foreign = shape !== undefined && this.callerSaid !== "" && shape.names.some((n) => !this.callerSaid.includes(squash(n)));
    // A bare yes after the callee's own objection, question or hold no longer answers the caller's question.
    const weakOnly = shape !== undefined && shape.weak && !shape.strong && !shape.commit && !shape.restate;
    // 「水曜の2時な」 when the date on the table is a Tuesday: another day.
    const onTable = (field: string) => (this.pendingProposals.get(field) ?? this.latestVerified(field))?.value;
    const tableDate = onTable("date");
    const wrongDay = u.source === "callee" && typeof tableDate === "string" && [...u.text.matchAll(/([月火水木金土日])曜/g)].some((m) => WEEKDAYS.indexOf(m[1]!) !== new Date(`${tableDate}T12:00:00`).getDay());
    const sound = !echoed && !foreign && !wrongDay;
    const settles = shape !== undefined && sound && shapeSettles(shape, this.lastAsk) && !(weakOnly && !shape.echo && this.interrupted);
    // Said after a settlement, anything that is not a clean repeat and touches the terms or doubts them takes it back.
    if (shape && (unsettles(u.text, shape, this.confirmation === "callee_acceptance" || this.promised) || (hanging !== undefined && !shape.fits))) this.retractedAt = u.t;
    let claims = extractClaims(u, opts);
    if (u.source === "callee") {
      // 「2時」 said back for a proposed 14時: the same hour on a twelve-hour clock, unless 午前 says otherwise.
      const tableTime = onTable("time");
      for (const c of claims) {
        if (c.field !== "time" || typeof c.value !== "string" || typeof tableTime !== "string" || /午前|朝|am|a\.m\./i.test(c.span)) continue;
        const [h, min] = c.value.split(":").map(Number);
        if (h! >= 1 && h! <= 11 && tableTime === `${String(h! + 12).padStart(2, "0")}:${String(min).padStart(2, "0")}`) c.value = tableTime;
      }
      // A confirmation counts only in a finished, positive sentence about the booking (shape.ts `confirmationFits`).
      const had = claims.find((c) => c.field === "confirmed");
      claims = claims.filter((c) => c.field !== "confirmed");
      if (sound && !HEDGE_RE.test(u.text) && confirmationFits(u.text, opts)) claims.push(had ?? { field: "confirmed", value: true, span: this.heard, semantic: 0.95, polarity: "positive" });
    }
    const positive = claims.filter((c) => c.polarity === "positive");
    const acceptance = isAcceptance(u.text, u.source);
    const agreement = settles && u.source === "callee" && agreementClean(u.text) && (shape!.strong || shape!.commit || shape!.restate || isAgreement(u.text, u.source));

    // 1. Resolve pending claims from the other side.
    const counterpart: Map<string, Evidence> =
      u.source === "caller" ? this.pendingOffers : this.pendingProposals;
    const appointment = this.confirmation === "callee_acceptance";
    const commitment = appointment && settles && u.source === "callee" && commitClean(u.text.trim());
    // 「了解です、その日は不在です」: an agreement word beside a statement that the terms cannot be met settles nothing.
    const unable = appointment && u.source === "callee" && UNABLE_RE.test(u.text.replace(/会議室/g, ""));
    // The utterance goes on to something else, but one sentence of it cleanly commits to terms it restates:
    // those fields, and only those, may settle (never `confirmed`, never a field it does not name).
    const partial = u.source === "callee" && sound && !agreement && !commitment && isAgreement(u.text, u.source) ? restatedInFittingSentences(u.text, opts) : [];
    const resolves = u.source === "caller" ? acceptance : !unable && (agreement || commitment || partial.length > 0);
    const restated = new Map(positive.map((c) => [c.field, c] as const));

    if (resolves) {
      for (const [field, pending] of [...counterpart.entries()]) {
        const r = restated.get(field);
        // Acknowledging an unresolved clock time cannot turn it into a value.
        if (pending.value === null || r?.ambiguous) continue;
        if (r && !valuesEqual(r.value, pending.value)) continue; // counter-proposal, handled below
        // 「50ケースは大丈夫です」 speaks for the quantity alone.
        if (u.source === "callee" && shape?.restatedOnly && !r) continue;
        if (u.source === "callee" && !agreement && !commitment && !partial.some((p) => p.field === field && valuesEqual(p.value, pending.value))) continue;
        // "ご予算について承知いたしました。…ですが" acknowledges the request; it settles the value
        // only when the callee restates it or answers without a contrast.
        if (!r && u.source === "callee" && CONTRAST_RE.test(u.text)) continue;
        // Appointment mode: a commitment that is not an agreement phrase (「はい。」, 「お待ちしております」)
        // settles only what the caller proposed in the turn it answers, or what the callee restates.
        if (commitment && !agreement && !r && pending.utteranceId !== this.lastCallerUtteranceId) continue;
        const mark = this.markVerified(pending, u, r);
        verifiedNow.push(mark);
        counterpart.delete(field);
      }
    }

    // 1a. 「6日は…あ、ちょっと待ってください」 then 「大丈夫でした。6日の14時で」: the callee's first mention took the
    //     caller's proposal over as its own pending offer. A value the caller proposed and the callee now commits to
    //     has been stated by both sides.
    if (u.source === "callee" && (agreement || commitment)) {
      for (const [field, offer] of [...this.pendingOffers.entries()]) {
        const r = restated.get(field);
        if (r?.ambiguous || offer.value === null || (r && !valuesEqual(r.value, offer.value)) || !valuesEqual(this.callerProposed.get(field), offer.value)) continue;
        verifiedNow.push(this.markVerified(offer, u, r));
        this.pendingOffers.delete(field);
      }
    }

    // 1b. A "yes" to the caller's explicit confirmation question is callee
    //     evidence of the commitment, even without the ritual phrase.
    //     So is a commitment that restates the terms ("10月3日に2名様で19,800円でご予約いたします")
    //     when it answers that question; unprompted, the same sentence is only an intention.
    const answersYes = settles && agreementClean(u.text) && !HOLD_RE.test(u.text) && !shape!.conditional;
    if (u.source === "callee" && this.pendingConfirmRequest && answersYes && !positive.some((c) => c.field === "confirmed")) {
      const ev = this.makeEvidence(u, { field: "confirmed", value: true, span: this.heard, semantic: 0.85, polarity: "positive" }, true);
      ev.explicit = false;
      ev.note = `agreed to confirmation request ${this.pendingConfirmRequest.id}`;
      this.nodes.push(ev);
      created.push(ev);
      verifiedNow.push(ev);
    }
    // A yes answers the last question of the turn, so the confirm request must be that question.
    const ask = u.source === "caller" ? callerAsk(u.text, opts) : undefined;
    this.pendingConfirmRequest = isConfirmRequest(u.text, u.source) && ask === "confirm" ? u : undefined;

    // 1b'. Reservation mode: the shop takes the caller's request to book and says it expects the guest
    //      (「承知しました。お待ちしております」「それでは5日の19時にお待ちしております」). Not after a question about
    //      availability, and not from the farewell alone: it needs an acknowledgement or the terms beside it.
    if (!appointment && u.source === "callee" && this.bookingAsked && answersYes && shape!.awaits && (shape!.strong || shape!.echo || shape!.restate) && !created.some((e) => e.field === "confirmed") && !positive.some((c) => c.field === "confirmed")) {
      const ev = this.makeEvidence(u, { field: "confirmed", value: true, span: this.heard, semantic: 0.85, polarity: "positive" }, true);
      ev.explicit = false;
      ev.note = "took the booking request and expects the guest";
      this.nodes.push(ev);
      created.push(ev);
      verifiedNow.push(ev);
    }

    // 1b''. Reservation mode: 「では10月5日19時、4名様でお取りします」. In shop speech the future form, said with
    //       EVERY value the caller asked for and nothing else, is the booking. Without the values (「取っとくわ」), with
    //       one missing or different, or with a condition, it stays an intention. Because it is a promise and not a
    //       record, anything the shop says afterwards that is not a settling shape takes it back (see `promised`).
    const TERM_FIELDS = ["date", "time", "partySize", "quantity", "price"];
    const asked = [...this.callerProposed.entries()].filter(([f]) => TERM_FIELDS.includes(f));
    const allRestated = asked.length > 0 && asked.every(([f, v]) => { const r = restated.get(f); return r !== undefined && !r.ambiguous && valuesEqual(r.value, v); });
    if (!appointment && u.source === "callee" && answersYes && shape!.willBook && allRestated && !created.some((e) => e.field === "confirmed") && !positive.some((c) => c.field === "confirmed")) {
      const ev = this.makeEvidence(u, { field: "confirmed", value: true, span: this.heard, semantic: 0.85, polarity: "positive" }, true);
      ev.explicit = false;
      ev.note = "will book, with every requested value restated";
      this.nodes.push(ev);
      created.push(ev);
      verifiedNow.push(ev);
      this.promised = true;
    }

    // 1c. Appointment mode: the callee's clean commitment to a complete slot is the confirmation.
    if (commitment && !created.some((e) => e.field === "confirmed") && !positive.some((c) => c.field === "confirmed")) {
      const known = (field: string) => {
        const r = restated.get(field);
        if (r) return r.value !== null && !r.ambiguous;
        return verifiedNow.some((v) => v.field === field) || this.latestVerified(field) !== undefined;
      };
      const slotKnown = ["date", "time"].every(known);
      // An order has no clock time: its terms are the quantity and the day (「50ケース、10月20日納品で大丈夫です」).
      // Only when nobody has spoken of a time, so a call that has one still needs the whole slot.
      const orderKnown = !slotKnown && !claims.some((c) => c.field === "time") && !this.nodes.some((n) => n.field === "time") && ["quantity", "date"].every(known);
      if (slotKnown || orderKnown) {
        const ev = this.makeEvidence(u, { field: "confirmed", value: true, span: this.heard, semantic: 0.9, polarity: "positive" }, true);
        ev.explicit = false;
        ev.note = orderKnown ? "callee committed to the quantity and the date (callee_acceptance)" : "callee committed to the slot (callee_acceptance)";
        this.nodes.push(ev);
        created.push(ev);
        verifiedNow.push(ev);
      }
    }

    // 2. Record new claims from this utterance (one per field/value per utterance).
    const seen = new Set<string>();
    for (const c of positive) {
      const key = `${c.field}:${JSON.stringify(c.value)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Authoritative: callee confirmation. Caller "confirmation" is recorded but never verified.
      if (c.field === "confirmed") {
        const ev = this.makeEvidence(u, c, u.source === "callee");
        if (u.source === "caller") ev.note = "caller-side confirmation is not evidence";
        else {
          ev.note = "explicit callee confirmation";
          verifiedNow.push(ev);
        }
        this.nodes.push(ev);
        created.push(ev);
        continue;
      }

      // Skip a restatement that just verified the counterpart's claim.
      const justVerified = verifiedNow.find((v) => v.field === c.field && valuesEqual(v.value, c.value));
      if (justVerified) continue;

      const ev = this.makeEvidence(u, c, false);
      if (c.ambiguous) {
        ev.explicit = false;
        ev.note = "ambiguous time: am/pm or an unambiguous 24-hour time is required";
      }
      const own = u.source === "callee" ? this.pendingOffers : this.pendingProposals;
      // If the same side restates an already-verified value, attach it to the history without changing state.
      const alreadyVerified = this.latestVerified(c.field);
      if (alreadyVerified && valuesEqual(alreadyVerified.value, ev.value)) {
        ev.verified = true;
        ev.note = "restates verified value";
      } else {
        if (alreadyVerified) {
          // Conflicts with a settled value: the field becomes unsettled (see values()).
          this.edges.push({ from: ev.id, to: alreadyVerified.id, relation: "supersedes" });
          ev.note = c.ambiguous ? `${ev.note}; supersedes ${alreadyVerified.id}` : `conflicts with verified ${alreadyVerified.id}`;
        }
        // The latest statement on a field supersedes any pending claim on it, from either side.
        for (const map of [own, counterpart]) {
          const prev = map.get(c.field);
          if (prev && prev.id !== ev.id) {
            if (!valuesEqual(prev.value, ev.value)) {
              this.edges.push({ from: ev.id, to: prev.id, relation: "supersedes" });
            }
            map.delete(c.field);
          }
        }
        own.set(c.field, ev);
      }
      this.nodes.push(ev);
      created.push(ev);
    }

    if (u.source === "caller") {
      this.lastCallerUtteranceId = u.id;
      // 「はい。」「はい、お待ちします。」「はい、午前中でお願いします。」 only answers the callee; the proposal stays on the
      // table, but after the detour only an explicit commit takes it up, not a bare yes or 「承知しました」.
      const interim = ask === "none" && /^はい[、。\s]*(?:お待ち(?:いた)?します|そうです|.{0,8}でお願い(?:いた|致)?します|お願い(?:いた|致)?します)?[。\s]*$/.test(u.text.trim());
      this.lastAsk = interim && this.lastAsk !== "none" ? "soft" : ask ?? "none";
      for (const c of positive) if (c.field !== "confirmed") this.callerProposed.set(c.field, c.value);
      this.lastCallerText = u.text;
      this.bookingAsked = ask !== undefined && ask !== "none" && /予約|お?席/.test(u.text) && !/空いて/.test(u.text);
      this.callerSaid += squash(u.text);
      this.interrupted = false;
      this.unfinished = undefined;
    } else if (shape && !shape.fits && shape.clauses.some((c) => c.kind !== "filler")) {
      this.interrupted = true;
    }
    if (u.source === "callee") this.unfinished = trailsOff(u.text) ? (hanging ?? "") + u.text : undefined;
    return { created, verified: verifiedNow };
  }

  private makeEvidence(u: Utterance, c: Claim, verified: boolean): Evidence {
    const ev: Evidence = {
      id: this.idFactory(),
      field: c.field,
      value: c.value,
      source: u.source,
      utteranceId: u.id,
      transcript: this.heard,
      span: c.span,
      confidence: {
        primaryAsr: u.asr?.primary ?? 1,
        semantic: c.semantic,
      },
      explicit: true,
      verified,
      t: u.t,
    };
    if (u.audio) ev.audio = u.audio;
    if (u.asr?.secondary !== undefined) ev.confidence.secondaryAsr = u.asr.secondary;
    return ev;
  }

  private markVerified(pending: Evidence, by: Utterance, restated?: Claim): Evidence {
    pending.verified = true;
    const relation = by.source === "caller" ? "accepted_by" : "confirmed_by";
    pending.note = restated
      ? `${relation.replace("_by", "")} with value restated by ${by.source}`
      : `${relation.replace("_by", "")} by ${by.source}`;
    // The accepting utterance becomes a node so the graph is navigable.
    const ack: Evidence = {
      id: this.idFactory(),
      field: pending.field,
      value: pending.value,
      source: by.source,
      utteranceId: by.id,
      transcript: this.heard,
      span: restated?.span ?? this.heard,
      confidence: { primaryAsr: by.asr?.primary ?? 1, semantic: restated ? 0.95 : 0.85 },
      explicit: Boolean(restated),
      verified: true,
      t: by.t,
      note: `${relation} ${pending.id}`,
    };
    if (by.audio) ack.audio = by.audio;
    this.nodes.push(ack);
    this.edges.push({ from: pending.id, to: ack.id, relation });
    return pending;
  }

  /** Latest verified evidence for a field (by ingestion order). */
  latestVerified(field: string): Evidence | undefined {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i]!;
      if (n.field === field && n.verified) return n;
    }
    return undefined;
  }

  /** Latest pending (unverified) claim for a field, from either side. */
  pending(field: string): Evidence | undefined {
    return this.pendingOffers.get(field) ?? this.pendingProposals.get(field);
  }

  /** Latest pending offer from the callee for a field. */
  pendingOffer(field: string): Evidence | undefined {
    return this.pendingOffers.get(field);
  }

  /** Latest pending proposal from the caller for a field. */
  pendingProposal(field: string): Evidence | undefined {
    return this.pendingProposals.get(field);
  }

  /**
   * Settled values, one per field: the latest claim on a field must itself be
   * verified. A newer, differing, unverified claim (e.g. the callee "confirming"
   * a different time than was agreed) unsettles the field until it is
   * accepted again. Caller-side `confirmed` claims never count either way.
   */
  values(): Record<string, unknown> {
    const latest = new Map<string, Evidence>();
    let confirmNode: Evidence | undefined;
    for (const n of this.nodes) {
      if (n.field === "confirmed") {
        // a callee retraction spoken after the confirmation revokes it (same-utterance retractions never produce the node)
        if (n.source === "callee" && n.verified && !(this.retractedAt !== undefined && this.retractedAt > n.t)) confirmNode = n;
        continue;
      }
      latest.set(n.field, n);
    }
    const out: Record<string, unknown> = {};
    for (const [field, n] of latest) if (n.verified) out[field] = n.value;

    // A confirmation is bound to the deal as it stood when it was spoken:
    // the values settled at that moment plus whatever the callee restated in
    // the same utterance. If any of those later change, the confirmation is
    // stale and must be re-issued.
    if (confirmNode) {
      const snapshot: Record<string, unknown> = {};
      const idx = this.nodes.indexOf(confirmNode);
      const settledThen = new Map<string, Evidence>();
      for (let i = 0; i < idx; i++) {
        const n = this.nodes[i]!;
        if (n.field !== "confirmed") settledThen.set(n.field, n);
      }
      for (const [field, n] of settledThen) if (n.verified) snapshot[field] = n.value;
      for (const n of this.nodes) {
        if (n.utteranceId === confirmNode.utteranceId && n.field !== "confirmed") snapshot[n.field] = n.value;
      }
      const stale = Object.entries(snapshot).some(([field, v]) => v !== undefined && out[field] !== v);
      if (!stale) out.confirmed = true;
    }
    return out;
  }

  graph(): EvidenceGraph {
    return { nodes: this.nodes.map((n) => ({ ...n })), edges: [...this.edges] };
  }

  all(): Evidence[] {
    return this.nodes.map((n) => ({ ...n }));
  }
}

export type { Speaker };
