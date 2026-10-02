import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, chmodSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/** SQLite's online backup includes committed WAL pages. A fresh directory prevents overwriting a backup. */
export async function backupDatabase(source, directory) {
  const output=resolve(directory),input=resolve(source);
  mkdirSync(output,{mode:0o700});
  const path=join(output,'gateway.sqlite');
  const db=new DatabaseSync(input,{readOnly:true});
  try { await backup(db,path); } finally { db.close(); }
  chmodSync(path,0o600);
  const saved=new DatabaseSync(path,{readOnly:true});
  try {
    const rows=saved.prepare('PRAGMA integrity_check').all();
    if(rows.length!==1||rows[0].integrity_check!=='ok')throw new Error('backup_integrity_failed');
  } finally { saved.close(); }
  // Reading a WAL-mode copy leaves empty -wal/-shm files beside it; a backup is the database and its manifest only.
  for(const suffix of ['-wal','-shm'])rmSync(path+suffix,{force:true});
  const manifest={createdAt:new Date().toISOString(),file:'gateway.sqlite',sha256:createHash('sha256').update(readFileSync(path)).digest('hex'),integrity:'ok',encryptionKeyIncluded:false};
  writeFileSync(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'});
  return {directory:output,...manifest};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const directory=process.argv[2];
  if(!directory||!process.env.OATHRA_DB||process.env.OATHRA_DB===':memory:') {
    console.error('Usage: node --env-file=<private-env> apps/gateway/backup.mjs <new-backup-directory>');process.exitCode=2;
  } else {
    try { console.log(JSON.stringify(await backupDatabase(process.env.OATHRA_DB,directory),null,2)); }
    catch(error) { console.error(JSON.stringify({error:error.code??error.message??'backup_failed'}));process.exitCode=1; }
  }
}
