// A supervisor sees their own team's calls and nobody else's; lists go in and come out without leaking or executing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Store } from '../lib/store.mjs';
import { Service } from '../lib/service.mjs';
import { hash } from '../lib/security.mjs';
import { teamCalls, teamRecord, teamCallsCsv, ownCallsCsv, importContacts, callsCsv } from '../lib/team.mjs';
import { createGateway } from '../server.mjs';
const now=Date.parse('2026-10-02T10:00:00+09:00');
function fixture(){
  const users=[['boss','care','manager'],['staff','care','operator'],['reader','care','viewer'],['root','care','admin'],['rival','sales','manager']].map(([id,team,role])=>({id,team,role,tokenHash:hash(id+'-token')}));
  const config={mode:'simulator',users,maxSeconds:300,maxCallUsd:10,dailyCalls:20,dailyUsd:30,rateCeilingUsd:0.1,setupFeeUsd:0,consentVersion:'v1',liveReady:false,publicUrl:'http://localhost:4244',missing:[]};
  const store=new Store(':memory:',randomBytes(32).toString('hex'),()=>now),service=new Service(store,config),by=id=>users.find(u=>u.id===id);
  const call=(owner,extra={})=>{const u=by(owner),m={id:randomUUID(),owner,team:u.team,kind:'phone-request',status:'INCOMPLETE',revision:1,mode:'live',createdAt:now-3600_000,finishedAt:now-3500_000,target:{name:'山田 花子',phone:'+819000000011'},
    request:'お変わりないか聞いてください。',phoneRequest:{schemaVersion:1,kind:'oathra.phone-request',phone:'+819000000011',name:'山田 花子',instruction:'お変わりないか聞いてください。'},transcript:[{id:'t1',source:'callee',text:'腰が痛いんです'}],result:{status:'INCOMPLETE',verified:{},evidence:[]},...extra};store.put('mission',m);return m;};
  return {config,store,service,by,call,close(){store.close();}};
}
const using=fn=>async()=>{const f=fixture();try{await fn(f);}finally{f.close();}};
const code=fn=>{try{fn();return null;}catch(e){return e.code??e.name;}};

test('a manager sees the team’s calls without numbers or speech; other teams and other roles see nothing',using(f=>{
  const mine=f.call('staff',{answered:true,attention:{level:'concern',signals:[{level:'concern',category:'pain',phrase:'痛い',turn:'t1'}]}});
  f.call('staff',{status:'DRAFT'});f.call('rival');const quiet=f.call('boss',{answered:false,createdAt:now-7200_000});
  const view=teamCalls(f.service,f.by('boss'));
  assert.deepEqual(view.calls.map(c=>c.id),[mine.id,quiet.id]);assert.equal(view.needsAttention,1);
  assert.deepEqual(Object.keys(view.calls[0]).sort(),['answered','attention','checkIn','createdAt','direction','durationSeconds','finishedAt','id','kind','owner','recipient','scheduled','status']);
  assert.ok(!JSON.stringify(view).includes('+8190')&&!JSON.stringify(view).includes('腰が痛い'));
  assert.deepEqual(teamCalls(f.service,f.by('boss'),{attention:true}).calls.map(c=>c.id),[mine.id]);
  assert.equal(teamCalls(f.service,f.by('root')).calls.length,2);
  assert.equal(teamCalls(f.service,f.by('rival')).calls.length,1);
  for(const id of ['staff','reader'])assert.equal(code(()=>teamCalls(f.service,f.by(id))),'supervisor_required');
}));
test('opening a teammate’s record is audited; another team’s record does not exist',using(f=>{
  const mine=f.call('staff'),theirs=f.call('rival');
  const record=teamRecord(f.service,f.by('boss'),mine.id);
  assert.equal(record.owner,'staff');assert.equal(record.transcript[0].text,'腰が痛いんです');
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM audit WHERE action='team.record_viewed'").get().n,1);
  assert.equal(code(()=>teamRecord(f.service,f.by('boss'),theirs.id)),'not_found');
  assert.equal(code(()=>teamRecord(f.service,f.by('staff'),mine.id)),'supervisor_required');
}));
test('a manager can do what an operator can; a viewer still cannot write',using(f=>{
  assert.ok(f.service.contact(f.by('boss'),{name:'佐藤',phone:'090-1111-2222'}).id);
  assert.equal(code(()=>f.service.contact(f.by('reader'),{name:'佐藤',phone:'090-1111-2222'})),'read_only_account');
}));

test('the export opens in a spreadsheet as text: BOM, CRLF, quoted commas, and no cell can run as a formula',()=>{
  const csv=callsCsv([{id:'i1',owner:'staff',recipient:'=HYPERLINK("http://x","山田")',direction:'outbound',kind:'request',status:'INCOMPLETE',createdAt:'2026-10-02T00:00:00.000Z',answered:true,attention:'emergency',scheduled:true,durationSeconds:61,
    checkIn:{condition:'no',meal:'yes',medication:'unclear',sleep:'not_asked',help:'no_answer'}},{id:'i2',owner:'staff',recipient:'田中, 太郎\n+cmd',direction:'inbound',kind:'sales',status:'DECLINED',createdAt:'2026-10-02T00:00:00.000Z',answered:null,attention:null,scheduled:false,durationSeconds:null,checkIn:null}]);
  assert.ok(csv.startsWith('﻿日時,担当,相手,向き,種類,結果,応答,要確認,体調,食事,服薬,睡眠,相談・困りごと,通話秒数,定期,通話ID\r\n'));
  const lines=csv.slice(1).split('\r\n');
  assert.equal(lines[1],`2026/10/02 9:00,staff,"'=HYPERLINK(""http://x"",""山田"")",発信,依頼,未確定,あり,緊急,いいえ,はい,要確認,,返答なし,61,定期,i1`);
  assert.ok(csv.includes('"田中, 太郎\n+cmd",着信,営業,辞退・連絡停止,,,,,,,,,,i2\r\n'));
  for(const start of ['=1+1','+1','-1','@x','\tx'])assert.ok(callsCsv([{id:'i',owner:'o',recipient:start,direction:'outbound',kind:'request',status:'FAILED',createdAt:'2026-10-02T00:00:00.000Z',answered:null,attention:null,scheduled:false,durationSeconds:null,checkIn:null}]).includes(",'"+start.replace('\t','\t')),start);
});
test('the team export has no phone numbers; a person’s own export has theirs only; both are audited',using(f=>{
  f.call('staff');f.call('boss',{target:{name:'鈴木',phone:'+819000000022'}});f.call('rival',{target:{name:'他社',phone:'+819000000033'}});
  const team=teamCallsCsv(f.service,f.by('boss'));
  assert.ok(team.includes('山田 花子')&&team.includes('鈴木')&&!team.includes('他社')&&!team.includes('+8190'));
  const own=ownCallsCsv(f.service,f.by('boss'));
  assert.ok(own.includes('+819000000022')&&!own.includes('+819000000011')&&own.includes('電話番号'));
  assert.equal(code(()=>teamCallsCsv(f.service,f.by('staff'))),'supervisor_required');
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM audit WHERE action IN ('team.calls_exported','calls.exported')").get().n,2);
}));

test('importing a list: each row is created, a duplicate, or says why not; importing twice adds nothing',using(f=>{
  const rows=[{name:'山田 花子',phone:'090-1234-5678',relationship:'customer',basis:'入居者'},{name:'同じ番号',phone:'+81 90 1234 5678'},{name:'番号なし'},{name:'変な番号',phone:'12'},{name:'余計',phone:'090-2222-3333',role:'admin'},
    {company:'丸山商事',phone:'03-1234-5678',relationship:'inquiry',basis:'見積依頼'}];
  const first=importContacts(f.service,f.by('staff'),rows);
  assert.deepEqual(first.results.map(r=>r.status),['created','duplicate','invalid','invalid','invalid','created']);
  assert.deepEqual(first.results.filter(r=>r.error).map(r=>r.error),['contact_phone_required','invalid_contact_phone','invalid_contact_row']);
  assert.deepEqual([first.created,first.duplicate,first.invalid],[2,1,3]);
  assert.deepEqual(f.store.list('contact','staff').map(c=>c.phone).sort(),['+81312345678','+819012345678']);
  const again=importContacts(f.service,f.by('staff'),rows);assert.equal(again.created,0);assert.equal(f.store.list('contact','staff').length,2);
  assert.equal(importContacts(f.service,f.by('boss'),[rows[0]]).created,1,'another person’s list is their own');
  assert.equal(code(()=>importContacts(f.service,f.by('reader'),rows)),'read_only_account');
  assert.equal(code(()=>importContacts(f.service,f.by('staff'),[])),'import_1_to_500_rows');
  assert.equal(code(()=>importContacts(f.service,f.by('staff'),Array(501).fill(rows[0]))),'import_1_to_500_rows');
}));
test('the routes answer over HTTP with the right types and refusals',using(async f=>{
  f.call('staff');
  const app=await createGateway(f.config,{store:f.store,execute:async()=>({}),channels:{process:async()=>{},send:async()=>{}}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+app.server.address().port,get=(path,who)=>fetch(base+path,{headers:{authorization:'Bearer '+who+'-token'}});
  try{
    const list=await get('/v1/team/calls','boss');assert.equal(list.status,200);assert.equal((await list.json()).calls.length,1);
    assert.equal((await get('/v1/team/calls','staff')).status,403);assert.equal((await get('/v1/team/calls','rival')).status,200);
    const csv=await get('/v1/team/calls.csv','boss');assert.equal(csv.status,200);assert.match(csv.headers.get('content-type'),/^text\/csv/);assert.match(csv.headers.get('content-disposition'),/attachment/);
    assert.equal((await get('/v1/calls.csv','staff')).status,200);
    const imported=await fetch(base+'/v1/contacts/import',{method:'POST',headers:{authorization:'Bearer staff-token','content-type':'application/json'},body:JSON.stringify({contacts:[{name:'山田',phone:'090-1234-5678'}]})});
    assert.equal(imported.status,200);assert.equal((await imported.json()).created,1);
  }finally{await app.close();}
}));
