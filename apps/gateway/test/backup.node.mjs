// Online backup of the gateway database: real temporary SQLite files, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, closeSync, writeSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../lib/store.mjs';
import { backupDatabase } from '../backup.mjs';

const sha256=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const mission=(n=0)=>({id:randomUUID(),owner:'alice',team:'one',status:'COMPLETED',kind:'phone-request',request:'営業時間を確認する。 #'+n,target:{name:'テスト店',phone:'+819000000001'},result:{verified:{confirmed:true}},notes:'x'.repeat(600)});
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'gateway-backup-')),source=join(dir,'data','gateway.sqlite'),key=randomBytes(32).toString('hex');
  return {dir,source,key,target:join(dir,'backup'),open:()=>new Store(source,key),close(){rmSync(dir,{recursive:true,force:true});}};
}
const using=fn=>async()=>{const f=fixture();try{await fn(f);}finally{f.close();}};

test('a backup is one private database file plus a manifest whose sha256 matches the file',using(async f=>{
  const store=f.open();
  try{
    store.put('mission',mission());
    const result=await backupDatabase(f.source,f.target);
    for(const name of ['gateway.sqlite','manifest.json'])assert.ok(readdirSync(f.target).includes(name),name);
    const manifest=JSON.parse(readFileSync(join(f.target,'manifest.json'),'utf8'));
    assert.deepEqual(result,{directory:f.target,...manifest});
    assert.equal(manifest.file,'gateway.sqlite');assert.equal(manifest.integrity,'ok');
    assert.match(manifest.sha256,/^[a-f0-9]{64}$/);assert.equal(manifest.sha256,sha256(join(f.target,'gateway.sqlite')));
    assert.ok(Math.abs(Date.parse(manifest.createdAt)-Date.now())<60_000);
    // The data key is never part of a backup: not in the manifest, not in the directory.
    assert.equal(manifest.encryptionKeyIncluded,false);
    assert.ok(!readFileSync(join(f.target,'manifest.json'),'utf8').includes(f.key));
    assert.ok(!readFileSync(join(f.target,'gateway.sqlite')).includes(Buffer.from(f.key,'hex')));
    if(process.platform!=='win32'){
      assert.equal(statSync(f.target).mode&0o777,0o700);
      for(const name of readdirSync(f.target))assert.equal(statSync(join(f.target,name)).mode&0o777,0o600,name);
    }
    // Payloads stay sealed in the copy.
    assert.ok(!readFileSync(join(f.target,'gateway.sqlite')).includes('+819000000001'));
  }finally{store.close();}
}));

test('a backup directory holds exactly the database and its manifest',using(async f=>{
  const store=f.open();
  try{store.put('mission',mission());await backupDatabase(f.source,f.target);assert.deepEqual(readdirSync(f.target).sort(),['gateway.sqlite','manifest.json']);}
  finally{store.close();}
}));

test('an existing target directory is refused and left untouched',using(async f=>{
  const store=f.open();
  try{
    store.put('mission',mission());
    // An empty directory is still an existing directory.
    mkdirSync(f.target);
    await assert.rejects(backupDatabase(f.source,f.target),{code:'EEXIST'});
    assert.deepEqual(readdirSync(f.target),[]);
    // A previous backup is never overwritten, even after the source changed.
    const first=join(f.dir,'first'),before=await backupDatabase(f.source,first);
    store.put('mission',mission(1));
    await assert.rejects(backupDatabase(f.source,first),{code:'EEXIST'});
    assert.equal(sha256(join(first,'gateway.sqlite')),before.sha256);
    assert.equal(JSON.parse(readFileSync(join(first,'manifest.json'),'utf8')).sha256,before.sha256);
    // A parent that does not exist is not created silently.
    await assert.rejects(backupDatabase(f.source,join(f.dir,'missing','nested')),{code:'ENOENT'});
  }finally{store.close();}
}));

test('rows written just before the backup, still in the WAL, are in the copy',using(async f=>{
  const store=f.open();
  try{
    const early=mission(0);store.put('mission',early);
    store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    // Written after the checkpoint and never checkpointed: these live only in the -wal file while the store stays open.
    const late=Array.from({length:20},(_,i)=>mission(i+1));for(const m of late)store.put('mission',m);
    store.setKey('agent-token','digest','agent-1');store.audit('alice','call.approved',late[0].id,{mission:late[0].id});
    assert.ok(statSync(f.source+'-wal').size>0,'the fixture must have an un-checkpointed WAL');
    const mainOnly=join(f.dir,'main-only.sqlite');copyFileSync(f.source,mainOnly);
    const result=await backupDatabase(f.source,f.target);
    // Self-contained: nothing the copy needs is left in a sidecar WAL (only gateway.sqlite is restored below).
    if(existsSync(join(f.target,'gateway.sqlite-wal')))assert.equal(statSync(join(f.target,'gateway.sqlite-wal')).size,0);
    copyFileSync(join(f.target,'gateway.sqlite'),join(f.dir,'restored-copy.sqlite'));
    const restored=new Store(join(f.dir,'restored-copy.sqlite'),f.key);
    try{
      assert.deepEqual(restored.get('mission',early.id),early);
      for(const m of late)assert.deepEqual(restored.get('mission',m.id),m);
      assert.equal(restored.all('mission','alice').length,21);
      assert.equal(restored.key('agent-token','digest'),'agent-1');
      assert.ok(restored.audits().some(a=>a.action==='call.approved'&&a.detail.mission===late[0].id));
    }finally{restored.close();}
    // The plain file copy without the WAL is what the backup must not be: it lacks the late rows.
    const stale=new Store(mainOnly,f.key);
    try{assert.equal(stale.get('mission',late[0].id),null);}finally{stale.close();}
    // Reading the backup for this check did not touch the backup itself.
    assert.equal(sha256(join(f.target,'gateway.sqlite')),result.sha256);
    // The source keeps working and was not modified by being backed up.
    assert.equal(store.all('mission','alice').length,21);
  }finally{store.close();}
}));

test('restore: the backup file opens with the same key through Store and a mission reads back; a wrong key does not',using(async f=>{
  const store=f.open(),m=mission();
  let result;
  try{store.put('mission',m);store.put('phone-grant',{id:randomUUID(),owner:'alice',status:'ACTIVE',phones:['+819000000001']});result=await backupDatabase(f.source,f.target);}
  finally{store.close();}
  // Verify the manifest, lose the original entirely, then place the file at an empty restore location.
  assert.equal(sha256(join(f.target,result.file)),result.sha256);
  rmSync(join(f.dir,'data'),{recursive:true,force:true});
  const restoredPath=join(f.dir,'restored','gateway.sqlite');mkdirSync(join(f.dir,'restored'),{mode:0o700});copyFileSync(join(f.target,result.file),restoredPath);
  const restored=new Store(restoredPath,f.key);
  try{
    assert.deepEqual(restored.get('mission',m.id),m);
    assert.deepEqual(restored.list('mission','alice').map(x=>x.id),[m.id]);
    assert.equal(restored.all('phone-grant','alice').length,1);
    // A restored database is a working database: it accepts writes and a second backup.
    const next=mission(1);restored.put('mission',next);assert.deepEqual(restored.get('mission',next.id),next);
    const again=await backupDatabase(restoredPath,join(f.dir,'backup-2'));assert.equal(again.integrity,'ok');
  }finally{restored.close();}
  // Without the key the backup is ciphertext: another key cannot open a record.
  const other=new Store(join(f.target,result.file),randomBytes(32).toString('hex'));
  try{assert.throws(()=>other.get('mission',m.id));}finally{other.close();}
}));

test('a corrupted source fails the backup and leaves no manifest that would vouch for it',using(async f=>{
  const store=f.open();
  for(let i=0;i<300;i++)store.put('mission',mission(i));
  store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');store.close();
  // Overwrite every page after the first with noise: the header still says SQLite, the b-trees are gone.
  const size=statSync(f.source).size;assert.ok(size>4096*8,'the fixture must span several pages');
  const fd=openSync(f.source,'r+');try{writeSync(fd,randomBytes(size-4096),0,size-4096,4096);}finally{closeSync(fd);}
  for(const name of ['-wal','-shm'])rmSync(f.source+name,{force:true});
  await assert.rejects(backupDatabase(f.source,f.target));
  assert.equal(existsSync(join(f.target,'manifest.json')),false);
}));

test('a corrupted source is reported with the coded integrity error',using(async f=>{
  const store=f.open();
  for(let i=0;i<300;i++)store.put('mission',mission(i));
  store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');store.close();
  // Damage a single interior page: the file opens and copies, only the integrity check can tell.
  const fd=openSync(f.source,'r+');try{writeSync(fd,Buffer.alloc(4096,0xff),0,4096,4096*5);}finally{closeSync(fd);}
  for(const name of ['-wal','-shm'])rmSync(f.source+name,{force:true});
  await assert.rejects(backupDatabase(f.source,f.target),/backup_integrity_failed|malformed|corrupt/i);
  assert.equal(existsSync(join(f.target,'manifest.json')),false);
}));

test('a missing source is an error, not an empty backup',using(async f=>{
  await assert.rejects(backupDatabase(join(f.dir,'absent.sqlite'),f.target));
  assert.equal(existsSync(join(f.target,'manifest.json')),false);
}));

test('command line: needs a target directory and a file database, and prints the manifest on success',using(async f=>{
  const script=fileURLToPath(new URL('../backup.mjs',import.meta.url));
  const run=(args,env)=>spawnSync(process.execPath,['--no-warnings',script,...args],{env:{PATH:process.env.PATH,...env},encoding:'utf8'});
  const store=f.open(),m=mission();
  try{
    store.put('mission',m);
    for(const [args,env] of [[[],{OATHRA_DB:f.source}],[[f.target],{}],[[f.target],{OATHRA_DB:':memory:'}]]){const r=run(args,env);assert.equal(r.status,2);assert.match(r.stderr,/Usage:/);assert.equal(existsSync(f.target),false);}
    const ok=run([f.target],{OATHRA_DB:f.source});
    assert.equal(ok.status,0,ok.stderr);
    const printed=JSON.parse(ok.stdout);assert.equal(printed.sha256,sha256(join(f.target,'gateway.sqlite')));assert.equal(printed.encryptionKeyIncluded,false);
    const again=run([f.target],{OATHRA_DB:f.source});
    assert.equal(again.status,1);assert.deepEqual(JSON.parse(again.stderr.trim().split('\n').pop()),{error:'EEXIST'});
  }finally{store.close();}
}));

// ---------------------------------------------------------------------------------------------- restore
{
  const { restoreDatabase } = await import('../restore.mjs');
  const { backupDatabase } = await import('../backup.mjs');
  const { Store } = await import('../lib/store.mjs');
  const { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { randomBytes } = await import('node:crypto');
  const made = async () => {
    const dir = mkdtempSync(join(tmpdir(), 'restore-')), key = randomBytes(32).toString('hex'), db = join(dir, 'live', 'gateway.sqlite');
    (await import('node:fs')).mkdirSync(join(dir, 'live'));
    const store = new Store(db, key); store.put('mission', { id: 'm1', owner: 'alice', status: 'COMPLETED', note: '復元の確認' }); store.close();
    await backupDatabase(db, join(dir, 'backup'));
    return { dir, key, db, backup: join(dir, 'backup'), done() { rmSync(dir, { recursive: true, force: true }); } };
  };
  const code = fn => { try { fn(); return null; } catch (e) { return e.code; } };
  test('restore: a backup comes back readable with the same key, and the records are checked before it is left in place', async () => {
    const f = await made();
    try {
      const target = join(f.dir, 'restored', 'gateway.sqlite'), result = restoreDatabase(f.backup, target, f.key);
      assert.equal(result.recordsChecked, 1);
      const store = new Store(target, f.key); try { assert.equal(store.get('mission', 'm1').note, '復元の確認'); } finally { store.close(); }
    } finally { f.done(); }
  });
  test('restore: never overwrites a database, refuses a tampered backup, and leaves nothing behind with the wrong key', async () => {
    const f = await made();
    try {
      assert.equal(code(() => restoreDatabase(f.backup, f.db, f.key)), 'restore_target_exists');
      const target = join(f.dir, 'restored.sqlite');
      assert.equal(code(() => restoreDatabase(f.backup, target, randomBytes(32).toString('hex'))), 'data_key_does_not_open_backup');
      assert.equal(existsSync(target), false); assert.equal(existsSync(target + '-wal'), false);
      const file = join(f.backup, 'gateway.sqlite'), bytes = readFileSync(file); bytes[bytes.length - 1] ^= 0xff; (await import('node:fs')).chmodSync(file, 0o600); writeFileSync(file, bytes);
      assert.equal(code(() => restoreDatabase(f.backup, target, f.key)), 'backup_hash_mismatch'); assert.equal(existsSync(target), false);
      assert.equal(code(() => restoreDatabase(join(f.dir, 'nothing'), target, f.key)), 'backup_manifest_unreadable');
    } finally { f.done(); }
  });
}
