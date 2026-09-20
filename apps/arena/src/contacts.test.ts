import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContactStore } from "./contacts.js";

const dirs: string[] = [];
const setup = () => {
  const root = mkdtempSync(join(tmpdir(), "oathra-contacts-")); dirs.push(root);
  return { dir: join(root, "contacts"), calls: join(root, "calls"), store: new ContactStore(join(root, "contacts"), join(root, "calls")) };
};
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("real local contact persistence", () => {
  it("stores the actual project as an organization without phone, survives reopening, and preserves manual call notes", () => {
    const { dir, calls, store } = setup();
    const contact = store.save({ company: "Oathra", notes: "ローカルの連絡先保存を確認" });
    expect(contact.phone).toBe(""); expect(contact.name).toBe("");
    expect(statSync(join(dir, `${contact.id}.json`)).mode & 0o777).toBe(0o600);
    const reopened = new ContactStore(dir, calls);
    expect(reopened.detail(contact.id)).toEqual({ contact, history: [] });
    const { id, createdAt, updatedAt, ...input } = contact;
    const updated = reopened.save({ ...input, lastCallNotes: "電話は未実施" }, id);
    expect(updated.revision).toBe(2); expect(updated.createdAt).toBe(createdAt);
    expect(JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8")).lastCallNotes).toBe("電話は未実施");
    expect(() => store.save(input, id)).toThrow("更新されています");
    expect(store.list()).toEqual([updated]);
  });
  it("rejects absent labels and malformed optional fields without creating a record", () => {
    const { store } = setup();
    for (const input of [{}, { name: " " }, { company: "Oathra", phone: "invalid" }, { company: "Oathra", email: "invalid" }, { company: "Oathra", unknown: true }]) expect(() => store.save(input)).toThrow("入力内容");
    expect(store.list()).toEqual([]);
    expect(() => store.get("../../README")).toThrow("見つかりません");
  });
  it("reports actual corrupted storage and filesystem failures instead of empty success", () => {
    const { store, dir } = setup();
    const contact = store.save({ company: "Oathra" });
    writeFileSync(join(dir, `${contact.id}.json`), "{");
    expect(() => store.list()).toThrow("読み書きできません");
    expect(() => store.save({ company: "Oathra", revision: 1 }, contact.id)).toThrow("読み書きできません");
    const { store: blocked, dir: blockedDir } = setup();
    writeFileSync(blockedDir, "directory path occupied by a file");
    expect(() => blocked.save({ company: "Oathra" })).toThrow("読み書きできません");
  });
  it("keeps the contact editable when the actual history directory is corrupted", () => {
    const { store, calls } = setup();
    // Existing phone-input validation number, used solely to enter the phone-linked
    // history branch. No dialer/network exists in ContactStore; real fs fails below.
    const contact = store.save({ company: "Oathra", phone: "09012345678" });
    mkdirSync(join(calls, "interrupted-save"), { recursive: true });
    writeFileSync(join(calls, "interrupted-save", "events.jsonl"), "{");
    const detail = store.detail(contact.id);
    expect(detail.contact).toEqual(contact);
    expect(detail.history).toEqual([]);
    expect(detail.historyError).toContain("履歴を読み込めません");
    const { id, createdAt, updatedAt, ...input } = contact;
    const updated = store.save({ ...input, notes: "履歴読込失敗中も編集可能" }, id);
    expect(updated.revision).toBe(2);
    expect(store.get(id).notes).toBe("履歴読込失敗中も編集可能");
    rmSync(join(calls, "interrupted-save"), { recursive: true });
    expect(store.detail(id)).toEqual({ contact: updated, history: [] });
  });
  it("rejects a concurrent writer while preserving the prior record", () => {
    const { store, dir } = setup(); const contact = store.save({ company: "Oathra" });
    mkdirSync(join(dir, ".write-lock"));
    expect(() => store.save({ company: "Oathra", revision: 1 }, contact.id)).toThrow("別の保存処理");
    expect(store.get(contact.id)).toEqual(contact);
  });
});
