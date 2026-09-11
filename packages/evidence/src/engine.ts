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
 */
import { extractClaims, isAcceptance, isAffirmativeAnswer, isAgreement, isConfirmRequest, type Claim } from "./extract.js";
import type { Evidence, EvidenceEdge, EvidenceGraph, Language, Speaker, Utterance } from "./types.js";

export type EngineOptions = {
  now?: Date;
  language?: Language;
  idFactory?: () => string;
};

export type IngestResult = {
  created: Evidence[];
  verified: Evidence[];
};

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
  private seq = 0;

  constructor(opts: EngineOptions = {}) {
    this.now = opts.now ?? new Date();
    this.language = opts.language ?? "ja";
    this.idFactory = opts.idFactory ?? (() => `ev_${++this.seq}`);
  }

  ingest(u: Utterance): IngestResult {
    const created: Evidence[] = [];
    const verifiedNow: Evidence[] = [];
    const claims = extractClaims(u, { now: this.now, language: this.language });
    const positive = claims.filter((c) => c.polarity === "positive");
    const acceptance = isAcceptance(u.text, u.source);
    const agreement = isAgreement(u.text, u.source);

    // 1. Resolve pending claims from the other side.
    const counterpart: Map<string, Evidence> =
      u.source === "caller" ? this.pendingOffers : this.pendingProposals;
    const resolves = u.source === "caller" ? acceptance : agreement;
    const restated = new Map(positive.map((c) => [c.field, c] as const));

    if (resolves) {
      for (const [field, pending] of [...counterpart.entries()]) {
        const r = restated.get(field);
        if (r && !valuesEqual(r.value, pending.value)) continue; // counter-proposal, handled below
        const mark = this.markVerified(pending, u, r);
        verifiedNow.push(mark);
        counterpart.delete(field);
      }
    }

    // 1b. A "yes" to the caller's explicit confirmation question is callee
    //     evidence of the commitment, even without the ritual phrase.
    if (u.source === "callee" && this.pendingConfirmRequest && isAffirmativeAnswer(u.text) && !positive.some((c) => c.field === "confirmed")) {
      const ev = this.makeEvidence(u, { field: "confirmed", value: true, span: u.text, semantic: 0.85, polarity: "positive" }, true);
      ev.explicit = false;
      ev.note = `agreed to confirmation request ${this.pendingConfirmRequest.id}`;
      this.nodes.push(ev);
      created.push(ev);
      verifiedNow.push(ev);
    }
    this.pendingConfirmRequest = isConfirmRequest(u.text, u.source) ? u : undefined;

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
          ev.note = `conflicts with verified ${alreadyVerified.id}`;
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

    return { created, verified: verifiedNow };
  }

  private makeEvidence(u: Utterance, c: Claim, verified: boolean): Evidence {
    const ev: Evidence = {
      id: this.idFactory(),
      field: c.field,
      value: c.value,
      source: u.source,
      utteranceId: u.id,
      transcript: u.text,
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
      transcript: by.text,
      span: restated?.span ?? by.text,
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
        if (n.source === "callee" && n.verified) confirmNode = n;
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
