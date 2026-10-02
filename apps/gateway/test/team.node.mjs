// A supervisor sees their own team's calls and nobody else's; lists go in and come out without leaking or executing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Store } from '../lib/store.mjs';
import { Service } from '../lib/service.mjs';
import { hash } from '../lib/security.mjs';
import { teamCalls, teamRecord, teamCallsCsv, teamSummary, teamPeople, contactHistory, ownCallsCsv, importContacts, callsCsv } from '../lib/team.mjs';
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
  assert.deepEqual(Object.keys(view.calls[0]).sort(),['answered','attention','checkIn','checkInLevels','createdAt','direction','durationSeconds','finishedAt','id','kind','owner','ownerName','recipient','scheduled','settled','settles','status']);
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

test('the summary counts the team’s own calls by day, and the answer rate only over calls where it is known',using(f=>{
  f.call('staff',{answered:true,status:'COMPLETED',billing:{carrier:{durationSeconds:60}}});f.call('staff',{answered:false,attention:{level:'emergency',signals:[]}});
  f.call('boss',{direction:'inbound',answered:null,handoff:{status:'COMPLETED'}});f.call('boss',{answered:true,createdAt:now-3*86400_000,status:'DECLINED'});
  f.call('boss',{createdAt:now-30*86400_000});f.call('rival',{answered:true});
  const s=teamSummary(f.service,f.by('boss'));
  assert.deepEqual(s.total,{calls:4,outbound:3,inbound:1,answered:2,unanswered:1,completed:1,declined:1,failed:0,unknown:0,attention:1,emergency:1,transferred:1,seconds:60,answerRatePercent:66.7});
  assert.deepEqual(s.byDay.map(d=>[d.date,d.calls]),[['2026-09-29',1],['2026-10-02',3]]);
  assert.equal(teamSummary(f.service,f.by('boss'),90).total.calls,5);
  assert.equal(code(()=>teamSummary(f.service,f.by('staff'))),'supervisor_required');assert.equal(code(()=>teamSummary(f.service,f.by('boss'),0)),'invalid_days');
}));

test('one person’s calls over time: answers per topic, days missed in a row, and only for those who may see them',using(f=>{
  const contact=f.service.contact(f.by('staff'),{name:'山田 花子',phone:'+819000000011',relationship:'customer',basis:'入居者'});
  const day=n=>now-n*86400_000,report=(medication,meal='yes')=>({status:'INCOMPLETE',checkIn:{answered:true,attention:medication==='no'?'concern':'none',items:[{topic:'condition',answer:'yes'},{topic:'meal',answer:meal},{topic:'medication',answer:medication},{topic:'sleep',answer:'not_asked'},{topic:'help',answer:'no'}],signals:[]}});
  f.call('staff',{createdAt:day(5),answered:true,result:report('yes')});f.call('staff',{createdAt:day(4),answered:true,result:report('no')});f.call('staff',{createdAt:day(3),answered:true,result:report('unclear','no')});
  f.call('staff',{createdAt:day(2),answered:false});f.call('staff',{createdAt:day(1),answered:false});f.call('staff',{createdAt:day(60),answered:true});f.call('staff',{createdAt:day(1),status:'DRAFT'});
  f.call('staff',{createdAt:day(1),answered:true,target:{name:'別の人',phone:'+819000000099'}});
  const h=contactHistory(f.service,f.by('staff'),contact.id);
  assert.deepEqual(h.summary,{calls:5,answered:3,unanswered:2,attention:1,emergency:0,missedInARow:2,topics:{condition:{yes:3},meal:{yes:2,no:1},medication:{yes:1,no:1,unclear:1},sleep:{},help:{no:3}}});
  assert.deepEqual(h.calls.map(c=>c.createdAt<h.calls.at(-1).createdAt||c===h.calls.at(-1)),[true,true,true,true,true],'oldest first');
  assert.ok(!JSON.stringify(h).includes('+8190')&&!JSON.stringify(h).includes('腰が痛い'));
  assert.equal(contactHistory(f.service,f.by('staff'),contact.id,90).summary.calls,6);
  assert.equal(contactHistory(f.service,f.by('boss'),contact.id).summary.calls,5);
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM audit WHERE action='team.history_viewed'").get().n,1);
  for(const id of ['rival','reader'])assert.equal(code(()=>contactHistory(f.service,f.by(id),contact.id)),'not_found',id);
}));
test('the team list names teammates by the name they call under, not only by their sign-in id',using(f=>{
  f.service.saveCallerName(f.by('staff'),'鈴木');f.call('staff');f.call('boss');
  assert.deepEqual(teamCalls(f.service,f.by('boss')).calls.map(c=>[c.owner,c.ownerName]).sort(),[['boss','boss'],['staff','鈴木']]);
  assert.ok(teamCallsCsv(f.service,f.by('boss')).includes(',鈴木,'));
}));

test('the people board: one line per person the team calls, the ones needing a look first, no numbers',using(f=>{
  const saved=f.service.contact(f.by('staff'),{name:'山田 花子',phone:'+819000000011',relationship:'customer',basis:'入居者'});
  const day=n=>now-n*86400_000,who=(name,phone)=>({target:{name,phone}});
  f.call('staff',{createdAt:day(3),answered:true});f.call('staff',{createdAt:day(2),answered:false});f.call('staff',{createdAt:day(1),answered:false});
  f.call('staff',{...who('佐藤 一郎','+819000000012'),createdAt:day(1),answered:true});
  f.call('boss',{...who('鈴木 ミツ','+819000000013'),createdAt:day(2),answered:true,attention:{level:'emergency',signals:[]}});
  f.call('boss',{...who('古い人','+819000000014'),createdAt:day(60),answered:true});f.call('rival',{...who('他社の人','+819000000015'),createdAt:day(1)});
  f.call('staff',{...who('着信の人','+819000000016'),createdAt:day(1),direction:'inbound'});
  const board=teamPeople(f.service,f.by('boss'));
  assert.deepEqual(board.people.map(p=>[p.recipient,p.owner,p.calls,p.answered,p.unanswered,p.missedInARow,p.emergency]),[['鈴木 ミツ','boss',1,1,0,0,1],['山田 花子','staff',3,1,2,2,0],['佐藤 一郎','staff',1,1,0,0,0]]);
  assert.equal(board.needsAttention,2);assert.equal(board.people[1].contactId,saved.id);assert.equal(board.people[0].contactId,null);
  assert.ok(!JSON.stringify(board).includes('+8190'));
  assert.equal(code(()=>teamPeople(f.service,f.by('staff'))),'supervisor_required');assert.equal(teamPeople(f.service,f.by('rival')).people.length,1);
}));
test('a row says whether the call had something to settle, and the level of each check-in answer',using(f=>{
  const care=f.call('staff',{attention:{level:'emergency',signals:[{level:'emergency',category:'breathing',phrase:'息が苦し',turn:'t1'}]},result:{status:'INCOMPLETE',checkIn:{answered:true,attention:'emergency',signals:[],items:[{topic:'condition',answer:'no',turn:'t1'},{topic:'meal',answer:'yes',turn:'t2'},{topic:'medication',answer:'no',turn:'t3'},{topic:'sleep',answer:'not_asked'},{topic:'help',answer:'no',turn:'t4'}]}}});
  f.call('staff',{kind:'sales',phoneRequest:undefined,status:'COMPLETED',createdAt:now-7200_000});
  const rows=teamCalls(f.service,f.by('boss')).calls,row=rows.find(r=>r.id===care.id),sales=rows.find(r=>r.kind==='sales');
  assert.deepEqual(row.checkInLevels,{condition:'emergency',meal:null,medication:'concern',sleep:null,help:null});
  assert.deepEqual([row.settles,row.settled,sales.settles,sales.settled],[false,false,true,true]);
}));
