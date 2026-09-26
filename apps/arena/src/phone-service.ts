import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PhoneRequestSchema, type PhoneRequest } from "@oathra/contract";
import type { CallEvent } from "@oathra/core";
import { renderCallSummary, saveCall } from "@oathra/replay";
import type { CallOutcome } from "@oathra/runtime";

/** Experimental local Web telephone adapter. inspect MUST have no external side effects. */
export type PhoneEngineChoice = { id: string; label: string; ready: boolean; issues: string[]; voices: string[]; defaultVoice: string; voiceTraits?: Record<string, string> };
export type PhoneReadiness = {
  ready: boolean; issues: string[]; provider: string; engine: string; recording: boolean; disclosure: string; configurationId?: string;
  /** Speech-to-speech engines this server can use, so the form can offer a choice. */
  engines?: PhoneEngineChoice[]; defaultEngine?: string;
};
export interface PhoneDialer {
  inspect(request?: PhoneRequest): PhoneReadiness | Promise<PhoneReadiness>;
  execute(request: PhoneRequest, ctx: { callId: string; reviewedConfigurationId?: string; signal: AbortSignal; onEvent: (event: CallEvent) => void }): Promise<CallOutcome>;
}
export type PhoneCallState = "draft" | "starting" | "running" | "stopping" | "ended" | "failed" | "unknown";
export type PhoneCallRecord = {
  id: string; request: PhoneRequest; state: PhoneCallState; createdAt: string; updatedAt: string;
  expiresAt: string; readiness: PhoneReadiness; events: CallEvent[];
  transcript: { source: "caller" | "callee"; text: string; turnId: string; startMs: number; endMs: number }[];
  ownerPid?: number; resolvedAt?: string; summary?: string; error?: string; endReason?: string; persistence?: "saved" | "failed";
};
/** The dialer refused before contacting the carrier: nothing rang, so the outcome is known. */
export class PhoneNotDialedError extends Error {}
export class PhoneServiceError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const idPattern = /^phone_[0-9a-f-]{36}$/;

/** A carrier or engine failure, in words the caller can act on. The original message stays in the events. */
export function phoneFailureText(message: string): string {
  if (/media stream/i.test(message)) return "通話先へ音声をつなげられませんでした。公開接続先（OATHRA_PUBLIC_WS_URL）に届いていません。相手の電話は短く鳴って切れた可能性があります。トンネルを起動し直し、設定を確認してから発信してください。";
  if (/call (busy|no-answer)/i.test(message)) return "相手が応答しませんでした（話し中または不在）。";
  if (/call (failed|canceled)/i.test(message)) return "通信会社で発信が完了しませんでした。番号と通信会社の設定を確認してください。";
  return `通話処理でエラーが発生しました: ${message.slice(0, 200)}`;
}
const activeStates: PhoneCallState[] = ["starting", "running", "stopping"];
const STALE_LOCK_MS = 60_000;
const unavailable: PhoneReadiness = { ready: false, issues: ["このサーバーでは実電話の接続が設定されていません。"], provider: "unconfigured", engine: "unconfigured", recording: false, disclosure: "発信は設定完了後の明示的な確認が必要です。" };
const storageError = () => new PhoneServiceError(503, "PHONE_STORAGE_ERROR", "電話履歴を保存・読み込みできません。発信を繰り返さず保存先を確認してください。");

/** Durable approval claims precede dialer execution. No retry of a claimed request, including after crashes. */
export class PhoneService {
  private active = new Map<string, { record: PhoneCallRecord; controller: AbortController }>();
  private starting = new Map<string, Promise<PhoneCallRecord>>();
  constructor(private dir: string, private callsDir: string, private dialer?: PhoneDialer) {}
  async status(request?: PhoneRequest): Promise<PhoneReadiness> {
    return this.dialer ? this.dialer.inspect(request) : { ...unavailable, issues: [...unavailable.issues] };
  }
  private write(record: PhoneCallRecord): void {
    let temporary: string | undefined;
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      temporary = join(this.dir, `.${randomUUID()}.tmp`);
      const fd = openSync(temporary, "wx", 0o600);
      try { writeFileSync(fd, JSON.stringify(record) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temporary, join(this.dir, `${record.id}.json`));
      const directory = openSync(this.dir, "r");
      try { fsyncSync(directory); } finally { closeSync(directory); }
    } catch { throw storageError(); }
    finally { if (temporary) rmSync(temporary, { force: true }); }
  }
  get(id: string): PhoneCallRecord {
    if (!idPattern.test(id)) throw new PhoneServiceError(404, "PHONE_NOT_FOUND", "電話履歴が見つかりません。");
    const live = this.active.get(id);
    if (live) return structuredClone(live.record);
    let record: PhoneCallRecord;
    try {
      record = JSON.parse(readFileSync(join(this.dir, `${id}.json`), "utf8")) as PhoneCallRecord;
      if (record.id !== id || !["draft", ...activeStates, "ended", "failed", "unknown"].includes(record.state) || !Array.isArray(record.events) || !Array.isArray(record.transcript)) throw storageError();
      PhoneRequestSchema.parse(record.request);
      if (!Number.isFinite(Date.parse(record.expiresAt)) || !record.readiness || typeof record.readiness.ready !== "boolean") throw storageError();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new PhoneServiceError(404, "PHONE_NOT_FOUND", "電話履歴が見つかりません。");
      throw storageError();
    }
    if (activeStates.includes(record.state)) {
      let ownerAlive = false;
      if (record.ownerPid) { try { process.kill(record.ownerPid, 0); ownerAlive = true; } catch (error) { ownerAlive = (error as NodeJS.ErrnoException).code === "EPERM"; } }
      if (!ownerAlive) {
        record.state = "unknown";
        record.error = "実行プロセスが終了したため通話結果を確認できません。通信事業者の履歴で確認してください。自動再発信はしません。";
        // Read-only recovery: never race another process's persisted update.
      }
    }
    return record;
  }
  list(): PhoneCallRecord[] {
    let names: string[];
    try { names = readdirSync(this.dir); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw storageError(); }
    return names.filter(name => name.endsWith(".json")).map(name => this.get(name.slice(0, -5))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async prepare(request: PhoneRequest): Promise<PhoneCallRecord> {
    request = PhoneRequestSchema.parse(request);
    const now = Date.now();
    const record: PhoneCallRecord = { id: `phone_${randomUUID()}`, request, state: "draft", createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), expiresAt: new Date(now + 10 * 60_000).toISOString(), readiness: await this.status(request), events: [], transcript: [] };
    this.write(record);
    return record;
  }
  start(id: string, approved: unknown): Promise<PhoneCallRecord> {
    if (approved !== true) return Promise.reject(new PhoneServiceError(400, "PHONE_APPROVAL_REQUIRED", "宛先・目的・費用・送信先を確認して発信を承認してください。"));
    const pending = this.starting.get(id);
    if (pending) return pending;
    const promise = this.claimAndStart(id).finally(() => this.starting.delete(id));
    this.starting.set(id, promise);
    return promise;
  }
  private async claimAndStart(id: string): Promise<PhoneCallRecord> {
    let record = this.get(id);
    if (record.state !== "draft") return record;
    const lock = join(this.dir, ".approval-lock");
    const acquire = (): void => { mkdirSync(lock, { mode: 0o700 }); };
    try { acquire(); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw storageError();
      // The section below takes well under a second. A lock this old was left by a process that died
      // inside it, and would otherwise refuse every call until someone deleted it by hand. The durable
      // per-call claim, not this lock, is what prevents a second dial.
      let stale = false;
      try { stale = Date.now() - statSync(lock).mtimeMs > STALE_LOCK_MS; } catch { stale = true; }
      if (!stale) throw new PhoneServiceError(409, "PHONE_APPROVAL_BUSY", "別の発信処理が進行中か、確認が必要です。履歴を確認してください。");
      try { rmSync(lock, { recursive: true, force: true }); acquire(); }
      catch { throw new PhoneServiceError(409, "PHONE_APPROVAL_BUSY", "別の発信処理が進行中か、確認が必要です。履歴を確認してください。"); }
    }
    try {
      record = this.get(id);
      if (record.state !== "draft") return record;
      if (Date.now() > Date.parse(record.expiresAt)) throw new PhoneServiceError(409, "PHONE_REVIEW_EXPIRED", "確認から10分が経過しました。内容を確認し直してください。");
      const unresolved = this.list().find(other => other.id !== id && (activeStates.includes(other.state) || (other.state === "unknown" && !other.resolvedAt)));
      if (unresolved) throw new PhoneServiceError(409, "PHONE_CALL_ACTIVE", "進行中または結果未確認の電話があります。履歴で終了を確認してから発信してください。");
      const readiness = await this.status(record.request);
      if (!readiness.ready || !this.dialer) throw new PhoneServiceError(409, "PHONE_NOT_READY", readiness.issues.join(" ") || "電話接続の設定が必要です。");
      if (JSON.stringify(readiness) !== JSON.stringify(record.readiness)) throw new PhoneServiceError(409, "PHONE_CONFIGURATION_CHANGED", "接続設定が変更されました。費用・送信先を確認し直してください。");
      record.state = "starting";
      record.updatedAt = new Date().toISOString();
      record.ownerPid = process.pid;
      this.write(record); // durable claim BEFORE any external action
      const controller = new AbortController();
      this.active.set(id, { record, controller });
      void this.execute(record, controller);
      return structuredClone(record);
    } finally { rmSync(lock, { recursive: true, force: true }); }
  }
  private async execute(record: PhoneCallRecord, controller: AbortController): Promise<void> {
    try {
      const outcome = await this.dialer!.execute(record.request, {
        callId: record.id, ...(record.readiness.configurationId ? { reviewedConfigurationId: record.readiness.configurationId } : {}), signal: controller.signal,
        onEvent: event => {
          record.events.push(event);
          if (event.type === "call.connected" && record.state === "starting") record.state = "running";
          // The reason a call failed belongs on the record the screen shows, not only in the event log.
          if (event.type === "error" && event.fatal !== false && !record.error) record.error = phoneFailureText(event.message);
          if (event.type === "transcript.final") record.transcript.push({ source: event.source, text: event.text, turnId: event.turnId, startMs: event.startMs, endMs: event.endMs });
          record.updatedAt = new Date().toISOString();
          try { this.write(record); } catch { record.error = "通話途中の履歴を保存できません。通話を停止し結果を確認しています。"; controller.abort(); }
        },
      });
      record.endReason = outcome.endReason;
      record.summary = renderCallSummary(outcome);
      record.state = outcome.endReason === "error" ? "failed" : "ended";
      try { saveCall(outcome, this.callsDir); record.persistence = "saved"; }
      catch { record.persistence = "failed"; record.error = "通話は終了しましたが成果物を保存できませんでした。履歴の内容を確認してください。"; }
    } catch (error) {
      if (error instanceof PhoneNotDialedError) {
        record.state = "failed";
        record.error = `発信していません。${error.message}`;
      } else {
        record.state = "unknown";
        // Keep a reason already reported during the call (「音声をつなげられませんでした」) ahead of the generic one.
        record.error = `${record.error ? record.error + " " : ""}通信処理が途絶えたため発信・終了結果を確認できません。通信事業者の履歴で確認してください。自動再発信はしません。`;
      }
    } finally {
      record.updatedAt = new Date().toISOString();
      let persisted = false;
      try { this.write(record); persisted = true; } catch { record.persistence = "failed"; record.error = "結果を保存できません。画面の内容を控え、通信事業者の履歴を確認してください。"; }
      // Retain final in-memory evidence if disk persistence failed; otherwise the file is the record
      // and a finished call must not stay in memory for the life of the process.
      if (persisted) this.active.delete(record.id);
    }
  }
  acknowledge(id: string, confirmedEnded: unknown): PhoneCallRecord {
    if (confirmedEnded !== true) throw new PhoneServiceError(400, "PHONE_END_CONFIRMATION_REQUIRED", "通信事業者で通話終了を確認してください。");
    const record = this.get(id);
    if (record.state !== "unknown") throw new PhoneServiceError(409, "PHONE_NOT_UNKNOWN", "結果未確認の履歴のみ確認済みにできます。");
    record.resolvedAt ??= new Date().toISOString();
    record.updatedAt = new Date().toISOString();
    this.write(record);
    const live = this.active.get(id);
    if (live) live.record = record;
    return record;
  }
  hangup(id: string): PhoneCallRecord {
    const record = this.get(id);
    if (!activeStates.includes(record.state)) return record;
    const live = this.active.get(id);
    if (!live) throw new PhoneServiceError(409, "PHONE_EXECUTOR_UNAVAILABLE", "このプロセスから通話を停止できません。発信元プロセスまたは通信事業者で確認してください。");
    live.record.state = "stopping";
    live.record.updatedAt = new Date().toISOString();
    try { this.write(live.record); } finally { live.controller.abort(); }
    return structuredClone(live.record);
  }
}
