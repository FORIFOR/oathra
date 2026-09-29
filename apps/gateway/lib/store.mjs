import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { assert, hash, mac, random } from './security.mjs';

/** A single-node durable store. Every payload (including webhook messages) is encrypted with AES-256-GCM. */
export class Store {
  constructor(path, key, now = () => Date.now()) {
    assert(typeof key === 'string' && /^[a-f0-9]{64}$/i.test(key), 'data_key_must_be_32_bytes_hex', 500);
    this.cipherKey = Buffer.from(key, 'hex'); this.now = now;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,owner TEXT NOT NULL,status TEXT NOT NULL,body TEXT NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(kind,id));
      CREATE INDEX IF NOT EXISTS records_owner ON records(kind,owner,status);
      CREATE TABLE IF NOT EXISTS keys(scope TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(scope,key));
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,mission TEXT NOT NULL,owner TEXT NOT NULL,body TEXT NOT NULL,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,owner TEXT NOT NULL,action TEXT NOT NULL,subject TEXT NOT NULL,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS lease(id INTEGER PRIMARY KEY CHECK(id=1),holder TEXT NOT NULL,expires INTEGER NOT NULL);`);
    // Databases created before audit details existed gain the column in place.
    if (!this.db.prepare('PRAGMA table_info(audit)').all().some(c => c.name === 'detail')) this.db.exec("ALTER TABLE audit ADD COLUMN detail TEXT NOT NULL DEFAULT ''");
    if (path !== ':memory:') chmodSync(path, 0o600);
  }
  seal(value) {
    const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', this.cipherKey, iv);
    return Buffer.concat([iv, c.update(JSON.stringify(value)), c.final(), c.getAuthTag()]).toString('base64');
  }
  open(value) {
    const b = Buffer.from(value, 'base64'), d = createDecipheriv('aes-256-gcm', this.cipherKey, b.subarray(0, 12));
    d.setAuthTag(b.subarray(-16)); return JSON.parse(Buffer.concat([d.update(b.subarray(12, -16)), d.final()]).toString());
  }
  tx(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  get(kind, id) { const row = this.db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(kind, id); return row ? this.open(row.body) : null; }
  put(kind, record) {
    this.db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET owner=excluded.owner,status=excluded.status,body=excluded.body,updated=excluded.updated')
      .run(kind, record.id, record.owner, record.status ?? '', this.seal(record), this.now()); return record;
  }
  list(kind, owner, status) {
    let sql = 'SELECT body FROM records WHERE kind=?'; const args = [kind];
    if (owner !== undefined) { sql += ' AND owner=?'; args.push(owner); }
    if (status !== undefined) { sql += ' AND status=?'; args.push(status); }
    return this.db.prepare(sql + ' ORDER BY updated DESC LIMIT 1000').all(...args).map(r => this.open(r.body));
  }
  /** Every record of a kind for an owner: a ledger cannot stop at the newest thousand. */
  all(kind, owner) { return this.db.prepare('SELECT body FROM records WHERE kind=? AND owner=?').all(kind, owner).map(r => this.open(r.body)); }
  /** Safety checks must consider every record, including those outside a UI listing page. */
  some(kind, predicate) {
    for (const row of this.db.prepare('SELECT body FROM records WHERE kind=?').iterate(kind)) {
      if (predicate(this.open(row.body))) return true;
    }
    return false;
  }
  key(scope, key) { const r = this.db.prepare('SELECT value FROM keys WHERE scope=? AND key=? AND expires>?').get(scope, key, this.now()); return r?.value; }
  setKey(scope, key, value, ttl = 3650 * 86400_000) {
    this.db.prepare('INSERT INTO keys VALUES(?,?,?,?) ON CONFLICT(scope,key) DO UPDATE SET value=excluded.value,expires=excluded.expires').run(scope, key, value, this.now() + ttl);
  }
  delKey(scope, key) { this.db.prepare('DELETE FROM keys WHERE scope=? AND key=?').run(scope, key); }
  // The caller id and business name are the gateway's, not a team's: a person who said no to one team has said no to the number.
  suppress(team, phone) { const k = mac(this.cipherKey, phone); this.setKey(`suppress:${team}`, k, 'true'); this.setKey('suppress:*', k, 'true'); }
  suppressed(team, phone) { const k = mac(this.cipherKey, phone); return !!this.key(`suppress:${team}`, k) || !!this.key('suppress:*', k); }
  event(mission, event) {
    const r = this.db.prepare('INSERT INTO events(mission,owner,body,created) VALUES(?,?,?,?)').run(mission.id, mission.owner, this.seal(event), this.now());
    return Number(r.lastInsertRowid);
  }
  events(mission, owner, after = 0) { return this.db.prepare('SELECT seq,body FROM events WHERE mission=? AND owner=? AND seq>? ORDER BY seq LIMIT 500').all(mission, owner, after).map(r => ({ ...this.open(r.body), seq: r.seq })); }
  /** A keyed hash of a phone number: lets audit rows about the same person be correlated without storing the number. */
  phoneRef(phone) { return mac(this.cipherKey, phone).slice(0, 32); }
  /** `subject` stays a hash; `detail` is sealed like every other payload and must not carry raw phone numbers or transcripts. */
  audit(owner, action, subject, detail) {
    this.db.prepare('INSERT INTO audit(owner,action,subject,created,detail) VALUES(?,?,?,?,?)').run(owner, action, hash(subject), this.now(), detail ? this.seal(detail) : '');
  }
  audits({ after = 0, limit = 200 } = {}) {
    return this.db.prepare('SELECT seq,owner,action,subject,created,detail FROM audit WHERE seq>? ORDER BY seq LIMIT ?').all(after, Math.min(500, Math.max(1, limit)))
      .map(r => ({ seq: r.seq, owner: r.owner, action: r.action, subject: r.subject, created: r.created, detail: r.detail ? this.open(r.detail) : null }));
  }
  lease(holder) {
    return this.tx(() => {
      const r = this.db.prepare('SELECT * FROM lease WHERE id=1').get();
      if (r && r.holder !== holder && r.expires > this.now()) return false;
      this.db.prepare('INSERT INTO lease VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET holder=excluded.holder,expires=excluded.expires').run(holder, this.now() + 30_000); return true;
    });
  }
  enqueue(kind, id, owner, payload, { priority = false } = {}) {
    if (this.get(kind, id)) return; this.put(kind, { id, owner, status: 'pending', attempts: 0, available: this.now(), payload });
    // Approvals and cancellations expire in five minutes; they go to the front of the queue however long it is.
    if (priority) this.db.prepare('UPDATE records SET updated=0 WHERE kind=? AND id=?').run(kind, id);
  }
  /** Oldest first over the whole queue. (It used to be the oldest of the newest 1000, so a long queue starved its head.) */
  next(kind) {
    return this.db.prepare("SELECT body FROM records WHERE kind=? AND status='pending' ORDER BY updated ASC LIMIT 500").all(kind).map(r => this.open(r.body)).find(r => r.available <= this.now());
  }
  /** Jobs that gave up. They used to disappear without a trace. */
  failedJobs() { return Object.fromEntries(['inbox','outbox'].map(kind => [kind, this.db.prepare("SELECT COUNT(*) AS n FROM records WHERE kind=? AND status='failed'").get(kind).n])); }
  removeMission(m, record = true) {
    this.tx(() => { for (const kind of ['followup','inbox','outbox']) for (const r of this.list(kind,m.owner)) {
      if (r.missionId===m.id || r.payload?.missionId===m.id || (kind==='inbox' && r.id===m.sourceKey)) this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,r.id);
    }
    if(m.sourceKey) this.db.prepare("DELETE FROM records WHERE kind='inbox' AND id=?").run(m.sourceKey);
    this.db.prepare('DELETE FROM events WHERE mission=?').run(m.id); this.db.prepare("DELETE FROM records WHERE kind='mission' AND id=?").run(m.id);
    // The record is gone; what stays for the audit window is enough to answer "was this person called, when, on whose approval".
    if (record) this.audit(m.owner, 'mission.deleted', m.id, { mission: m.id, status: m.status, mode: m.mode, goal: m.goal, target: m.target?.phone ? this.phoneRef(m.target.phone) : null, carrierSid: m.carrierSid ?? null, approvedAt: m.approvedAt ?? null, finishedAt: m.finishedAt ?? null, doNotContact: m.result?.doNotContact === true }); });
  }
  prune(retentionDays = 30) {
    const cutoff = this.now() - retentionDays * 86400_000;
    this.db.prepare('DELETE FROM keys WHERE expires<?').run(this.now());
    this.db.prepare("DELETE FROM records WHERE kind IN ('inbox','outbox') AND status IN ('done','failed') AND updated<?").run(cutoff);
    this.db.prepare("DELETE FROM records WHERE kind='reservation' AND updated<?").run(this.now()-48*3600000);
    this.db.prepare('DELETE FROM audit WHERE created<?').run(this.now() - 90 * 86400_000);
    // A table booking holds a name: it goes once its day is as old as any other record may be.
    for (const row of this.db.prepare("SELECT id,body FROM records WHERE kind='table-booking'").all()) if (Date.parse(this.open(row.body).date + 'T00:00:00+09:00') < cutoff) this.db.prepare("DELETE FROM records WHERE kind='table-booking' AND id=?").run(row.id);
    // Walk every old mission, not the newest 1000. A mission untouched since the cutoff finished before it;
    // an abandoned draft holds a name and a number and expires on the same schedule.
    for (let last = 0;;) {
      const rows = this.db.prepare("SELECT body,updated FROM records WHERE kind='mission' AND updated<? AND updated>=? ORDER BY updated ASC LIMIT 200").all(cutoff, last);
      let removed = 0;
      for (const r of rows) {
        const m = this.open(r.body); last = Math.max(last, r.updated);
        if(m.billing?.state==='pending')continue;
        const finished = m.status !== 'UNKNOWN' && !m.stopNeedsReconciliation && m.finishedAt && m.finishedAt < cutoff;
        if (finished || m.status === 'DRAFT') { this.removeMission(m); removed++; }
      }
      if (rows.length < 200) break;
      if (removed === 0) last++; // everything in this page must be kept (UNKNOWN): step past it
    }
  }
  close() { this.db.close(); }
}
