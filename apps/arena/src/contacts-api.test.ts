import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { startArena, type ArenaServer } from "./server.js";

const root = mkdtempSync(join(tmpdir(), "oathra-contact-api-"));
let arena: ArenaServer;
beforeAll(async () => { arena = await startArena({ scenariosDir: resolve(import.meta.dirname, "../../../scenarios"), brains: {}, callsDir: join(root, "calls"), port: 0 }); });
afterAll(async () => { arena.server.closeAllConnections(); await arena.close(); rmSync(root, { recursive: true, force: true }); });
it("creates and updates an optional-phone organization through real HTTP, rejects stale revisions and cross-origin writes", async () => {
  const request = (path: string, method = "GET", body?: unknown, headers = {}) => fetch(arena.url + path, { method, headers: { "Content-Type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  expect(await (await request("/api/contacts")).json()).toEqual([]);
  expect((await request("/api/contacts", "POST", {})).status).toBe(400);
  expect((await request("/api/contacts", "POST", { company: "Oathra" }, { Origin: "https://example.com" })).status).toBe(403);
  const created = await request("/api/contacts", "POST", { company: "Oathra" });
  expect(created.status).toBe(201);
  const { contact } = await created.json();
  expect(await (await request(`/api/contacts/${contact.id}`)).json()).toEqual({ contact, history: [] });
  const input = { company: "Oathra", notes: "ローカル保存をHTTPから確認", revision: contact.revision };
  const updated = await request(`/api/contacts/${contact.id}`, "PUT", input);
  expect(updated.status).toBe(200); expect((await updated.json()).contact.revision).toBe(2);
  const stale = await request(`/api/contacts/${contact.id}`, "PUT", input);
  expect(stale.status).toBe(409); expect((await stale.json()).code).toBe("CONTACT_CONFLICT");
  expect((await request("/api/contacts/absent")).status).toBe(404);
  expect(await (await request("/api/calls")).json()).toEqual([]);
});
