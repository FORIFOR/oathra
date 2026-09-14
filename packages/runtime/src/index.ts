/**
 * CallRuntime — the loop that turns a CallContract + providers into a
 * VerifiedResult with a complete event log.
 *
 * It is transport-agnostic: the simulator and a SIP transport produce the
 * same SessionEvents, so the same loop drives games and real calls.
 */
import { checkConstraints, isPermitted, requiredFields, type Action, type CallContract } from "@oathra/contract";
import { EvidenceEngine, evaluate, type ConnectionState, type Utterance, type VerifiedResult } from "@oathra/evidence";
import {
  denyAll,
  EventLog,
  StateMachine,
  summarizeLatency,
  type BrainContext,
  type BrainProvider,
  type BrainResponse,
  type CallEvent,
  type CallSession,
  type DistributiveOmit,
  type EndReason,
  type EventInput,
  type LatencySummary,
  type MissionView,
  type PermissionGate,
  type SessionEvent,
  type TransportProvider,
  type Turn,
  type TurnTrace,
  type IntakeAnswer,
  type IntakeStatus,
  type IntakeView,
} from "@oathra/core";

export type RunOptions = {
  contract: CallContract;
  transport: TransportProvider;
  brain: BrainProvider;
  permissionGate?: PermissionGate;
  /** Anchors relative dates ("明日") in evidence extraction. */
  now?: Date;
  callId?: string;
  scenarioId?: string;
  onEvent?: (e: CallEvent) => void;
  /** If the callee has not spoken this long after connect, the agent opens. */
  openingTimeoutMs?: number;
};

export type CallMetrics = {
  durationMs: number;
  turns: number;
  agentTurns: number;
  calleeTurns: number;
  costUsd: number;
  latency: LatencySummary;
  evidenceCount: number;
  verifiedCount: number;
};

export type CallOutcome = {
  callId: string;
  contract: CallContract;
  result: VerifiedResult;
  events: readonly CallEvent[];
  traces: TurnTrace[];
  metrics: CallMetrics;
  endReason: EndReason;
  transcript: Turn[];
  intake: IntakeView;
};

/** Answering machines and carrier voicemail prompts, ja/en. */
export const VOICEMAIL_RE =
  /留守番電話|留守番|お掛けになった電話|おかけになった電話|電話に出ることができません|発信音の後|メッセージを(?:お預かり|録音)|ただいま電話に出られません|voicemail|voice mail|leave a message|after the tone|is not available|has been forwarded to an automated/i;

const normalizeLine = (t: string) => t.replace(/[\s、。,.!?！？「」]/g, "");

const INTAKE_YES_RE = /^(?:はい|ええ|そうです|大丈夫(?:です)?|問題(?:ありません|ございません)|もちろん|承知(?:しました|いたしました)?|お願いします|yes|sure|okay|ok|go ahead|sounds good|of course|absolutely)(?:$|[\s、,。.!?！？])/i;
const INTAKE_NO_RE = /^(?:いいえ|結構です|不要(?:です)?|答えたくありません|お答えできません|控えさせて|遠慮します|やめて|no|not now|rather not|prefer not|i(?:'d| would) rather not|don't want to|do not want to)(?:$|[\s、,。.!?！？])/i;
const INTAKE_QUESTION_RE = /[?？]|でしょうか|ですか\s*$|\b(?:what|which|who|where|when|why|how|can|could)\b/i;

let counter = 0;
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}`;

export class CallRuntime {
  readonly log = new EventLog();
  readonly state = new StateMachine();
  readonly engine: EvidenceEngine;
  readonly callId: string;
  private readonly transcript: Turn[] = [];
  private readonly traces: TurnTrace[] = [];
  private session: CallSession | undefined;
  private connection: ConnectionState = "idle";
  private cancelled = false;
  private costUsd = 0;
  private turnIndex = 0;
  private intakeStatus: IntakeStatus;
  private intakeAskedQuestions = 0;
  private intakePending: { kind: "consent" } | { kind: "field"; field: string } | undefined;
  private readonly intakeAnswers: IntakeAnswer[] = [];
  private readonly intakeDeclined = new Set<string>();

  constructor(private readonly opts: RunOptions) {
    this.callId = opts.callId ?? newId("call");
    this.intakeStatus = opts.contract.intake ? "not_started" : "disabled";
    const engineOpts: ConstructorParameters<typeof EvidenceEngine>[0] = { language: opts.contract.language };
    if (opts.now) engineOpts.now = opts.now;
    this.engine = new EvidenceEngine(engineOpts);
    if (opts.onEvent) this.log.subscribe(opts.onEvent);
    this.state.onChange((from, to) => this.emit({ type: "state.changed", from, to, ux: this.state.ux }));
  }

  private now(): number {
    return this.session?.now() ?? 0;
  }

  private emit(e: DistributiveOmit<CallEvent, "seq" | "t"> & { t?: number }): CallEvent {
    return this.log.append({ t: e.t ?? this.now(), ...e } as EventInput);
  }

  cancel(): void {
    this.cancelled = true;
    this.session?.interrupt();
    void this.session?.hangup("cancelled");
  }

  async run(): Promise<CallOutcome> {
    const { contract, transport, brain } = this.opts;
    const gate = this.opts.permissionGate ?? denyAll;
    let endReason: EndReason = "completed";
    const start = Date.now();

    this.emit({
      type: "call.started",
      t: 0,
      callId: this.callId,
      contract,
      transport: transport.name,
      brain: brain.name,
      ...(this.opts.scenarioId ? { scenario: this.opts.scenarioId } : {}),
    });
    this.state.transition("DIALING");
    this.connection = "dialing";

    try {
      this.session = await transport.connect(contract.target, { language: contract.language, contract });
      const session = this.session;
      const iterator = session.events[Symbol.asyncIterator]();

      let agentHungUp = false;
      let calleeSpoke = false;
      let openTurnId: string | undefined;
      const openingTimeout = this.opts.openingTimeoutMs ?? 1500;

      const nextEvent = async (timeoutMs?: number): Promise<SessionEvent | undefined> => {
        const p = iterator.next();
        if (timeoutMs === undefined) return (await p).value as SessionEvent | undefined;
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<"timeout">((res) => (timer = setTimeout(() => res("timeout"), timeoutMs)));
        const r = await Promise.race([p, timeout]);
        if (timer) clearTimeout(timer);
        if (r === "timeout") {
          // keep the pending iterator result for the next loop iteration
          pendingNext = p;
          return undefined;
        }
        return (r as IteratorResult<SessionEvent>).value as SessionEvent | undefined;
      };
      let pendingNext: Promise<IteratorResult<SessionEvent>> | undefined;

      while (!this.cancelled && !agentHungUp) {
        let ev: SessionEvent | undefined;
        if (pendingNext) {
          const r = await pendingNext;
          pendingNext = undefined;
          ev = r.value as SessionEvent | undefined;
          if (r.done) ev = undefined;
        } else if (this.connection === "active" && !calleeSpoke && this.turnIndex === 0) {
          ev = await nextEvent(openingTimeout);
          if (ev === undefined && pendingNext) {
            // Callee is silent: the agent opens the conversation.
            if (transport.speaksItself) {
              calleeSpoke = true; // the model handles openings itself
              continue;
            }
            agentHungUp = await this.agentTurn(session, brain, gate, this.now());
            if (agentHungUp) break;
            continue;
          }
        } else {
          const r = await iterator.next();
          ev = r.done ? undefined : (r.value as SessionEvent);
        }

        if (ev === undefined) {
          endReason = "callee_hangup";
          break;
        }

        if (ev.type === "connected") {
          this.connection = "active";
          this.emit({ type: "call.connected", ...(ev.callee ? { callee: ev.callee } : {}) });
          this.state.transition("LISTENING");
          continue;
        }
        if (ev.type === "hangup") {
          endReason = "callee_hangup";
          break;
        }
        if (ev.type === "error") {
          const fatal = ev.fatal !== false;
          this.emit({ type: "error", message: ev.message, fatal });
          if (!fatal) continue;
          endReason = "error";
          this.connection = "failed";
          break;
        }
        if (ev.type === "interruption") {
          session.interrupt();
          continue;
        }
        if (ev.type === "agent.speech") {
          // Speech-to-speech transport: record the agent's own turn.
          const turnId = newId("turn");
          this.emit({ type: "agent.speech.started", turnId, text: ev.text, t: ev.startMs });
          this.emit({ type: "agent.speech.ended", turnId, startMs: ev.startMs, endMs: ev.endMs, interrupted: ev.interrupted ?? false, t: ev.endMs });
          this.emit({ type: "transcript.final", turnId, source: "caller", text: ev.text, startMs: ev.startMs, endMs: ev.endMs, t: ev.endMs });
          this.transcript.push({ id: turnId, source: "caller", text: ev.text, t: ev.endMs });
          this.observeIntakeQuestion(ev.text);
          this.ingest({ id: turnId, source: "caller", text: ev.text, t: ev.endMs, audio: { startMs: ev.startMs, endMs: ev.endMs } });
          const trace: TurnTrace = { turnId, speechEndMs: ev.startMs - (ev.ttfaMs ?? 0), playbackStartMs: ev.startMs };
          if (ev.ttfaMs !== undefined) trace.ttfaMs = ev.ttfaMs;
          this.traces.push(trace);
          this.emit({ type: "turn.trace", trace });
          this.turnIndex++;
          if (this.state.state !== "LISTENING" && this.state.canTransition("LISTENING")) this.state.transition("LISTENING");
          continue;
        }
        if (ev.type === "action.requested") {
          this.emit({ type: "permission.requested", action: ev.action, detail: ev.detail });
          let approved = isPermitted(contract, ev.action);
          let by: "policy" | "human" = "policy";
          if (!approved) {
            const d = await gate.ask(ev.action, ev.detail);
            approved = d.approved;
            by = d.by;
          }
          this.emit({ type: "permission.decided", action: ev.action, approved, by });
          session.resolveAction?.(ev.action, approved);
          continue;
        }
        if (ev.type === "audio") {
          // v0.1: audio transports must run STT themselves and deliver `speech`.
          this.emit({ type: "error", message: "raw audio events are not supported by this runtime build", fatal: false });
          continue;
        }
        if (ev.type === "speech.started") {
          calleeSpoke = true;
          openTurnId = newId("turn");
          this.emit({ type: "callee.speech.started", turnId: openTurnId, t: ev.startMs });
          continue;
        }
        if (ev.type === "speech") {
          calleeSpoke = true;
          // Coalesce utterances that queued up while the agent was busy
          // (thinking / speaking) so the brain answers the latest state of the
          // conversation instead of replying to each stale fragment in turn.
          const merged = { ...ev };
          for (;;) {
            const p = pendingNext ?? iterator.next();
            pendingNext = undefined;
            // One macrotask: anything already queued wins the race; nothing else is waited for.
            const tick = new Promise<"tick">((res) => setImmediate(() => res("tick")));
            const r = await Promise.race([p, tick]);
            if (r === "tick") {
              pendingNext = p;
              break;
            }
            const next = r as IteratorResult<SessionEvent>;
            if (next.done || next.value === undefined) {
              pendingNext = Promise.resolve(next);
              break;
            }
            const nv = next.value;
            if (nv.type === "speech") {
              merged.text = `${merged.text}${contract.language === "ja" ? "" : " "}${nv.text}`.trim();
              merged.endMs = Math.max(merged.endMs, nv.endMs);
              if (merged.asr && nv.asr) merged.asr = { primary: Math.min(merged.asr.primary, nv.asr.primary) };
              continue;
            }
            if (nv.type === "speech.started") continue; // the corresponding speech will follow or be coalesced
            pendingNext = Promise.resolve(next); // hangup / error / interruption: handle after this turn
            break;
          }
          ev = merged;
          // Voicemail: nobody is there to negotiate with. Hang up, report honestly.
          if (this.turnIndex <= 1 && VOICEMAIL_RE.test(ev.text)) {
            const vmTurn = openTurnId ?? newId("turn");
            this.emit({ type: "transcript.final", turnId: vmTurn, source: "callee", text: ev.text, startMs: ev.startMs, endMs: ev.endMs, t: ev.endMs });
            this.transcript.push({ id: vmTurn, source: "callee", text: ev.text, t: ev.endMs });
            endReason = "voicemail";
            await session.hangup("voicemail");
            break;
          }
          const turnId = openTurnId ?? newId("turn");
          if (!openTurnId) this.emit({ type: "callee.speech.started", turnId, t: ev.startMs });
          openTurnId = undefined;
          this.emit({ type: "callee.speech.ended", turnId, startMs: ev.startMs, endMs: ev.endMs, t: ev.endMs });
          if (this.state.state === "LISTENING") this.state.transition("TRANSCRIBING");
          this.emit({
            type: "transcript.final",
            turnId,
            source: "callee",
            text: ev.text,
            startMs: ev.startMs,
            endMs: ev.endMs,
            ...(ev.asr ? { asr: ev.asr } : {}),
          });
          const calleeTurn: Turn = { id: turnId, source: "callee", text: ev.text, t: ev.endMs };
          this.transcript.push(calleeTurn);
          this.captureIntakeAnswer(calleeTurn);
          this.ingest({ id: turnId, source: "callee", text: ev.text, t: ev.endMs, audio: { startMs: ev.startMs, endMs: ev.endMs }, ...(ev.asr ? { asr: ev.asr } : {}) });
          if (this.state.state === "TRANSCRIBING") this.state.transition("TURN_PENDING");

          // Budget checks before the agent replies.
          if (this.turnIndex >= contract.budget.maxTurns || this.now() > contract.budget.maxDurationMs) {
            endReason = "budget_exceeded";
            await session.hangup("budget_exceeded");
            break;
          }
          if (transport.speaksItself) {
            // The model answers on its own; ground it in the evidence state.
            session.updateContext?.(this.missionView());
            if (this.state.canTransition("LISTENING")) this.state.transition("LISTENING");
            continue;
          }
          agentHungUp = await this.agentTurn(session, brain, gate, ev.endMs);
          // The agent said goodbye: end the call now instead of waiting for another callee turn
          // (a human callee in Play mode would otherwise leave the call open until they type).
          if (agentHungUp) break;
        }
      }

      if (this.cancelled) endReason = "cancelled";
      if (agentHungUp) endReason = "agent_hangup";
      if (this.connection !== "failed") this.connection = "completed";
      await session.hangup(endReason).catch(() => undefined);
    } catch (e) {
      this.emit({ type: "error", message: (e as Error).message, fatal: true });
      this.connection = "failed";
      endReason = "error";
    }

    if (this.state.state !== "ENDED") this.state.transition("ENDED");
    const durationMs = this.session ? this.now() : Date.now() - start;
    this.emit({ type: "call.ended", reason: endReason, durationMs, t: durationMs });

    const result = evaluate(contract, this.engine, this.connection);
    this.emit({ type: "result", result, t: durationMs });

    const metrics: CallMetrics = {
      durationMs,
      turns: this.transcript.length,
      agentTurns: this.transcript.filter((t) => t.source === "caller").length,
      calleeTurns: this.transcript.filter((t) => t.source === "callee").length,
      costUsd: Number(this.costUsd.toFixed(5)),
      latency: summarizeLatency(this.traces),
      evidenceCount: result.evidence.length,
      verifiedCount: result.evidence.filter((e) => e.verified).length,
    };

    return {
      callId: this.callId,
      contract,
      result,
      events: this.log.all(),
      traces: this.traces,
      metrics,
      endReason,
      transcript: this.transcript,
      intake: this.intakeView(),
    };
  }

  private ingest(u: Utterance): void {
    const r = this.engine.ingest(u);
    for (const ev of r.created) this.emit({ type: "evidence.created", evidence: { ...ev } });
    for (const ev of r.verified) this.emit({ type: "evidence.verified", evidence: { ...ev } });
    const view = this.missionView();
    this.emit({ type: "mission.progress", verified: Object.keys(view.verified), missing: view.missing, pending: Object.keys(view.pending) });
  }

  private missionView(): MissionView {
    const verified = this.engine.values();
    const required = requiredFields(this.opts.contract);
    const pending: Record<string, unknown> = {};
    // Only the callee's pending offers are surfaced: the agent must never
    // "accept" its own unverified proposals.
    for (const f of new Set([...required, ...Object.keys(this.opts.contract.constraints)])) {
      const p = this.engine.pendingOffer(f);
      if (p) pending[f] = p.value;
    }
    const missing = required.filter((f) => verified[f] === undefined);
    const check = checkConstraints(this.opts.contract.constraints, verified);
    return { verified, pending, missing, violations: check.violations.map((v) => ({ ...v, rule: String(v.rule) })), intake: this.intakeView() };
  }

  private intakeView(): IntakeView {
    const config = this.opts.contract.intake;
    if (!config) return { status: "disabled", askedQuestions: 0, answers: [], declined: [] };
    return {
      status: this.intakeStatus,
      purpose: config.purpose,
      maxQuestions: config.maxQuestions,
      askedQuestions: this.intakeAskedQuestions,
      ...(this.intakePending?.kind === "field" ? { pendingField: this.intakePending.field } : {}),
      answers: [...this.intakeAnswers],
      declined: [...this.intakeDeclined],
    };
  }

  /** Register the question actually spoken so the next callee turn can be captured safely. */
  private registerIntakeQuestion(question: NonNullable<BrainResponse["intakeQuestion"]>): void {
    const config = this.opts.contract.intake;
    if (!config || this.intakeStatus === "declined" || this.intakeStatus === "complete") return;
    if (question.kind === "consent") {
      if (this.intakeStatus === "not_started" || this.intakeStatus === "awaiting_consent") {
        this.intakeStatus = "awaiting_consent";
        this.intakePending = { kind: "consent" };
        this.emit({ type: "intake.question", kind: "consent" });
      }
      return;
    }
    const field = config.fields.find((candidate) => candidate.key === question.field);
    if (!field || this.intakeStatus !== "active") return;
    if (this.intakeAskedQuestions >= config.maxQuestions || this.intakeAnswers.some((answer) => answer.key === field.key) || this.intakeDeclined.has(field.key)) return;
    this.intakeAskedQuestions++;
    this.intakePending = { kind: "field", field: field.key };
    this.emit({ type: "intake.question", kind: "field", field: field.key });
  }

  /** Best-effort marker for transports that emit agent speech without BrainResponse metadata. */
  private observeIntakeQuestion(text: string): void {
    const config = this.opts.contract.intake;
    if (!config) return;
    const normalized = normalizeLine(text).toLocaleLowerCase();
    if ((this.intakeStatus === "not_started" || this.intakeStatus === "awaiting_consent") && normalized.includes(normalizeLine(config.consentPrompt).toLocaleLowerCase())) {
      this.registerIntakeQuestion({ kind: "consent" });
      return;
    }
    if (this.intakeStatus !== "active") return;
    const field = config.fields.find((candidate) => normalized.includes(normalizeLine(candidate.question).toLocaleLowerCase()));
    if (field) this.registerIntakeQuestion({ kind: "field", field: field.key });
  }

  /** Consume exactly one callee turn after an explicit consent or field question. */
  private captureIntakeAnswer(turn: Turn): void {
    const config = this.opts.contract.intake;
    const pending = this.intakePending;
    if (!config || !pending) return;
    this.intakePending = undefined;
    if (pending.kind === "consent") {
      const text = turn.text.trim();
      const mixed = /(?:ですが|けど|ただ|but|however)/i.test(text);
      const granted = !mixed && INTAKE_YES_RE.test(text) ? true : !mixed && INTAKE_NO_RE.test(text) ? false : undefined;
      if (granted === undefined) {
        // A non-committal or ambiguous reply is not consent. End the optional
        // intake immediately so the agent never pressures the callee to answer.
        this.intakeStatus = "declined";
        this.emit({ type: "intake.consent", granted: false, utteranceId: turn.id });
        return;
      }
      this.intakeStatus = granted ? "active" : "declined";
      this.emit({ type: "intake.consent", granted, utteranceId: turn.id });
      return;
    }

    const field = config.fields.find((candidate) => candidate.key === pending.field);
    if (!field) return;
    const text = turn.text.trim();
    if (INTAKE_QUESTION_RE.test(text)) {
      if (this.intakeAskedQuestions >= config.maxQuestions) this.intakeStatus = "complete";
      return;
    }
    const declined = INTAKE_NO_RE.test(text) || /答えたく|お答えでき|控えさせ|遠慮させて/i.test(text);
    if (declined) {
      this.intakeDeclined.add(field.key);
      this.emit({ type: "intake.answer", field: field.key, declined: true, utteranceId: turn.id });
      if (config.stopOnDecline) this.intakeStatus = "declined";
    } else if (text) {
      const value = text.replace(/[\r\n]+/g, " ").slice(0, 500);
      this.intakeAnswers.push({ key: field.key, label: field.label, value, utteranceId: turn.id, transcript: text, t: turn.t });
      this.emit({ type: "intake.answer", field: field.key, value, declined: false, utteranceId: turn.id });
    }
    if (this.intakeStatus === "active") {
      const done = this.intakeAnswers.length + this.intakeDeclined.size >= config.fields.length;
      if (done || this.intakeAskedQuestions >= config.maxQuestions) this.intakeStatus = "complete";
    }
  }

  /** Run one agent turn. Returns true if the agent ended the call. */
  private async agentTurn(session: CallSession, brain: BrainProvider, gate: PermissionGate, speechEndMs: number): Promise<boolean> {
    const { contract } = this.opts;
    const turnId = newId("turn");
    const trace: TurnTrace = { turnId, speechEndMs, turnConfirmMs: this.now() };

    if (this.state.state !== "THINKING") this.state.transition("THINKING");
    const permitted = (Object.keys(contract.permissions) as Action[]).filter((a) => isPermitted(contract, a));
    const ctx: BrainContext = {
      contract,
      language: contract.language,
      transcript: [...this.transcript],
      mission: this.missionView(),
      intake: this.intakeView(),
      permitted,
      elapsedMs: this.now(),
      turnIndex: this.turnIndex,
    };
    this.emit({ type: "brain.request", turnId, brain: brain.name });
    trace.brainStartMs = this.now();
    const brainStartWall = Date.now();
    let firstToken = false;
    const lastCallee = [...this.transcript].reverse().find((t) => t.source === "callee");
    // Keep the rhythm: a short acknowledgement while the brain thinks, but only
    // after a substantive callee turn (not after "はい" or the greeting).
    if (session.ack && this.turnIndex > 0 && lastCallee && normalizeLine(lastCallee.text).length >= 6) session.ack();
    const hooks = {
      onToken: () => {
        if (!firstToken) {
          firstToken = true;
          trace.brainFirstTokenMs = this.now();
        }
      },
    };
    let response = await brain.respond(ctx, hooks);
    // Never say the exact same line twice in a row: the callee did not get it — unless the brain repeats
    // on purpose because the callee asked to hear it again (response.verbatim).
    const lastAgent = [...this.transcript].reverse().find((t) => t.source === "caller");
    if (!response.verbatim && lastAgent && normalizeLine(lastAgent.text) === normalizeLine(response.text)) {
      response = await brain.respond(
        { ...ctx, hints: ["The callee did not respond to your previous line. Do NOT repeat it. Say something different, much shorter, or ask one simple question."] },
        hooks,
      );
      // On a voice line a repeated line usually means the callee did not hear it; in a text
      // simulation it just means the brain is stuck, and "can you hear me?" would be nonsense.
      if (normalizeLine(lastAgent.text) === normalizeLine(response.text) && typeof session.ack === "function") {
        response = { ...response, text: contract.language === "ja" ? "もしもし、お声は届いておりますでしょうか？" : "Hello, can you hear me?" };
      }
    }
    trace.brainEndMs = this.now();
    if (!firstToken) trace.brainFirstTokenMs = trace.brainEndMs;
    const latencyMs = Date.now() - brainStartWall;
    if (response.usage?.costUsd) this.costUsd += response.usage.costUsd;
    this.emit({
      type: "brain.response",
      turnId,
      brain: brain.name,
      text: response.text,
      latencyMs,
      ...(response.usage?.costUsd !== undefined ? { costUsd: response.usage.costUsd } : {}),
      ...(response.action ? { action: response.action } : {}),
    });

    // Permission check: deterministic, outside the LLM.
    let text = response.text;
    if (!text.trim()) text = contract.language === "ja" ? "少々お待ちください。" : "One moment, please.";
    if (response.requestedAction) {
      const { action, detail } = response.requestedAction;
      this.state.transition("VERIFYING");
      if (!isPermitted(contract, action)) {
        this.state.transition("AWAITING_PERMISSION");
        this.emit({ type: "permission.requested", action, detail });
        const decision = await gate.ask(action, detail);
        this.emit({ type: "permission.decided", action, approved: decision.approved, by: decision.by });
        if (!decision.approved) {
          text = contract.language === "ja"
            ? "申し訳ありません、その点は私の一存ではお答えできません。"
            : "I'm sorry, I'm not authorised to do that.";
        }
      } else {
        this.emit({ type: "permission.decided", action, approved: true, by: "policy" });
      }
    }

    this.state.transition("SYNTHESIZING");
    this.emit({ type: "agent.speech.started", turnId, text });
    this.state.transition("SPEAKING");
    const spoke = await session.speak({ text, language: contract.language });
    trace.ttsFirstAudioMs = spoke.startMs;
    trace.playbackStartMs = spoke.startMs;
    trace.ttfaMs = Math.max(0, Math.round(spoke.startMs - speechEndMs));
    this.emit({ type: "agent.speech.ended", turnId, startMs: spoke.startMs, endMs: spoke.endMs, interrupted: spoke.interrupted, t: spoke.endMs });
    this.emit({ type: "transcript.final", turnId, source: "caller", text, startMs: spoke.startMs, endMs: spoke.endMs, t: spoke.endMs });
    this.traces.push(trace);
    this.emit({ type: "turn.trace", trace });

    this.transcript.push({ id: turnId, source: "caller", text, t: spoke.endMs });
    this.ingest({ id: turnId, source: "caller", text, t: spoke.endMs, audio: { startMs: spoke.startMs, endMs: spoke.endMs } });
    this.turnIndex++;

    if (response.action === "hangup") {
      this.state.transition("ENDED");
      return true;
    }
    if (response.intakeQuestion) this.registerIntakeQuestion(response.intakeQuestion);
    else this.observeIntakeQuestion(text);
    this.state.transition("LISTENING");
    return false;
  }
}

export async function runCall(opts: RunOptions): Promise<CallOutcome> {
  return new CallRuntime(opts).run();
}
