import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, chmodSync, existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store } from './lib/store.mjs';

/** Puts a backup (backup.mjs) in place of a database that is gone. It never overwrites one that is there, and it
 *  proves the copy before leaving it: the manifest's hash, SQLite's own integrity check, and that the data key
 *  given actually opens the records. The key is not in the backup; without it the data cannot be read. */
export function restoreDatabase(directory, target, dataKey) {
  const source = join(resolve(directory), 'gateway.sqlite'), output = resolve(target);
  const fail = code => { const e = new Error(code); e.code = code; throw e; };
  if (existsSync(output)) fail('restore_target_exists');
  let manifest; try { manifest = JSON.parse(readFileSync(join(resolve(directory), 'manifest.json'), 'utf8')); } catch { fail('backup_manifest_unreadable'); }
  if (!existsSync(source) || createHash('sha256').update(readFileSync(source)).digest('hex') !== manifest.sha256) fail('backup_hash_mismatch');
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  copyFileSync(source, output); chmodSync(output, 0o600);
  const discard = code => { for (const suffix of ['', '-wal', '-shm']) rmSync(output + suffix, { force: true }); fail(code); };
  let records = 0;
  try {
    const db = new DatabaseSync(output);
    try { const rows = db.prepare('PRAGMA integrity_check').all(); if (rows.length !== 1 || rows[0].integrity_check !== 'ok') throw new Error('integrity'); } finally { db.close(); }
  } catch { discard('backup_integrity_failed'); }
  try {
    const store = new Store(output, dataKey);
    try { for (const row of store.db.prepare('SELECT body FROM records LIMIT 200').iterate()) { store.open(row.body); records++; } } finally { store.close(); }
  } catch { discard('data_key_does_not_open_backup'); }
  return { restored: output, from: source, createdAt: manifest.createdAt, recordsChecked: records };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2];
  if (!directory || !process.env.OATHRA_DB || process.env.OATHRA_DB === ':memory:' || !process.env.OATHRA_DATA_KEY) {
    console.error('Usage: node --env-file=<private-env> apps/gateway/restore.mjs <backup-directory>\nStop the gateway first. OATHRA_DB must not exist yet; OATHRA_DATA_KEY must be the key the backup was made with.'); process.exitCode = 2;
  } else {
    try { console.log(JSON.stringify(restoreDatabase(directory, process.env.OATHRA_DB, process.env.OATHRA_DATA_KEY), null, 2)); }
    catch (error) { console.error(JSON.stringify({ error: error.code ?? 'restore_failed' })); process.exitCode = 1; }
  }
}
