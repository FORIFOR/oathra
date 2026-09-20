import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { ContactInputSchema, ContactUpdateSchema, ContactRecordSchema, normalizePhoneNumber, type ContactRecord } from "@oathra/contract";
import { loadCall } from "@oathra/replay";

export class ContactError extends Error {
  constructor(public status: number, public code: string, message: string, public issues?: unknown) { super(message); }
}
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const storageError = () => new ContactError(500, "CONTACT_STORAGE_ERROR", "連絡先または通話履歴を読み書きできません。保存先の権限とデータを確認してください。");

/** Synchronous atomic replacement and revision checks prevent interleaving in one server.
 * A directory lock also rejects concurrent writers from another server (no automatic retry).
 */
export class ContactStore {
  constructor(private dir: string, private callsDir: string) {}
  private run<T>(operation: () => T): T {
    try { return operation(); } catch (error) { if (error instanceof ContactError) throw error; throw storageError(); }
  }
  private entries(dir: string): string[] {
    try { return readdirSync(dir); } catch (error) { if (missing(error)) return []; throw error; }
  }
  get(id: string): ContactRecord {
    return this.run(() => {
      if (!idPattern.test(id)) throw new ContactError(404, "CONTACT_NOT_FOUND", "連絡先が見つかりません。");
      let raw: string;
      try { raw = readFileSync(join(this.dir, `${id}.json`), "utf8"); }
      catch (error) { if (missing(error)) throw new ContactError(404, "CONTACT_NOT_FOUND", "連絡先が見つかりません。"); throw error; }
      const contact = ContactRecordSchema.parse(JSON.parse(raw));
      if (contact.id !== id) throw storageError();
      return contact;
    });
  }
  list(): ContactRecord[] {
    return this.run(() => this.entries(this.dir).filter(name => name.endsWith(".json")).map(name => { if (!idPattern.test(name.slice(0, -5))) throw storageError(); return this.get(name.slice(0, -5)); }).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)));
  }
  save(input: unknown, id?: string): ContactRecord {
    const parsed = id === undefined ? ContactInputSchema.safeParse(input) : ContactUpdateSchema.safeParse(input);
    if (!parsed.success) throw new ContactError(400, "INVALID_INPUT", "入力内容を確認してください。", parsed.error.issues.map(issue => ({ path: issue.path, message: issue.message })));
    return this.run(() => {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      const lock = join(this.dir, ".write-lock");
      try { mkdirSync(lock, { mode: 0o700 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new ContactError(409, "CONTACT_CONFLICT", "別の保存処理が進行中です。保存結果を確認してから再操作してください。"); throw error; }
      let temporary: string | undefined;
      try {
        const previous = id === undefined ? undefined : this.get(id);
        if (previous && (!("revision" in parsed.data) || parsed.data.revision !== previous.revision)) throw new ContactError(409, "CONTACT_CONFLICT", "この連絡先は更新されています。最新の内容を読み直してください。");
        const now = new Date().toISOString();
        const contact = ContactRecordSchema.parse({ ...parsed.data, id: previous?.id ?? randomUUID(), revision: (previous?.revision ?? 0) + 1, createdAt: previous?.createdAt ?? now, updatedAt: now });
        temporary = join(this.dir, `.${randomUUID()}.tmp`);
        writeFileSync(temporary, JSON.stringify(contact, null, 2) + "\n", { mode: 0o600, flag: "wx" });
        renameSync(temporary, join(this.dir, `${contact.id}.json`));
        return contact;
      } finally {
        if (temporary) rmSync(temporary, { force: true });
        rmSync(lock, { recursive: true });
      }
    });
  }
  detail(id: string) {
    const contact = this.get(id);
    try {
      const history = this.run(() => {
        if (!contact.phone) return [];
        return this.entries(this.callsDir).flatMap(callId => {
          const directory = join(this.callsDir, callId);
          if (!statSync(directory).isDirectory()) return [];
          const call = loadCall(callId, this.callsDir);
          if (!call.contract.target.phone) return [];
          let phone: string;
          try { phone = normalizePhoneNumber(call.contract.target.phone); } catch { return []; }
          if (phone !== contact.phone) return [];
          return [{ id: callId, goal: call.contract.goal, status: call.result.status, summary: readFileSync(join(directory, "summary.md"), "utf8"), recordedAt: statSync(join(directory, "result.json")).mtime.toISOString() }];
        }).sort((a,b) => b.recordedAt.localeCompare(a.recordedAt));
      });
      return { contact, history };
    } catch {
      return { contact, history: [], historyError: "保存済み通話の履歴を読み込めません。連絡先は編集できます。通話保存先の権限とデータを確認してください。" };
    }
  }
}
