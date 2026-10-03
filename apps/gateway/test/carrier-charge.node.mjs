// Every finished real call shows what the carrier charged, whatever the billing policy.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {Store} from '../lib/store.mjs';
import {Phone} from '../lib/phone.mjs';
import {carrierChargeTotals} from '../lib/phone-service.mjs';

test('the carrier charge is fetched once priced, never from another account, and totals add up by Japan day',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'charge-')),store=new Store(join(dir,'db.sqlite'),randomBytes(32).toString('hex')),owner=randomUUID();
 const sid='CA'+randomBytes(16).toString('hex'),account='AC'+randomBytes(16).toString('hex');
 let data={sid,account_sid:account,status:'completed',duration:'178',price:null,price_unit:'JPY'};
 const server=createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data))});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const p=new Phone({store,credits:{},config:{}},{TWILIO_ACCOUNT_SID:account,TWILIO_AUTH_TOKEN:randomUUID()});p.callURL=()=>`http://127.0.0.1:${server.address().port}`;
 try{
  const m={id:randomUUID(),owner,mode:'live',status:'INCOMPLETE',carrierSid:sid,createdAt:Date.parse('2026-10-03T06:12:00Z'),finishedAt:Date.parse('2026-10-03T06:15:00Z')};
  assert.equal(await p.fetchCarrierCharge(m),null,'not priced yet');
  data={...data,sid:'CA'+randomBytes(16).toString('hex'),price:'-86.70732'};await assert.rejects(()=>p.fetchCarrierCharge(m),/identity/);
  data={...data,sid};const charge=await p.fetchCarrierCharge(m);
  assert.deepEqual({amount:charge.amount,currency:charge.currency,durationSeconds:charge.durationSeconds},{amount:86.70732,currency:'JPY',durationSeconds:178});
  data={...data,status:'no-answer',duration:'0',price:null};assert.equal((await p.fetchCarrierCharge(m)).amount,0,'an unanswered call costs nothing and is not left pending');
  const at=t=>Date.parse(t);
  store.put('mission',{...m,carrierCharge:{amount:86.70732,currency:'JPY',durationSeconds:178}});
  store.put('mission',{id:randomUUID(),owner,mode:'live',status:'INCOMPLETE',carrierSid:'CA1',finishedAt:at('2026-10-02T14:59:00Z'),carrierCharge:{amount:28.90244,currency:'JPY',durationSeconds:19}}); // 23:59 JST on the 2nd
  store.put('mission',{id:randomUUID(),owner,mode:'live',status:'INCOMPLETE',carrierSid:'CA2',finishedAt:at('2026-10-03T07:00:00Z')}); // not priced yet
  store.put('mission',{id:randomUUID(),owner,mode:'simulator',status:'COMPLETED',finishedAt:at('2026-10-03T07:00:00Z')});
  store.put('mission',{id:randomUUID(),owner,mode:'live',status:'INCOMPLETE',carrierSid:'CA3',finishedAt:at('2026-09-30T05:00:00Z'),carrierCharge:{amount:50,currency:'JPY',durationSeconds:60}});
  const t=carrierChargeTotals(store,owner,at('2026-10-03T08:00:00Z'));
  assert.deepEqual(t.today,{calls:1,seconds:178,amounts:{JPY:86.70732}});
  assert.deepEqual(t.month,{calls:2,seconds:197,amounts:{JPY:115.60976}});
  assert.equal(t.pending,1);
 }finally{await new Promise(r=>server.close(r));store.close();rmSync(dir,{recursive:true,force:true})}
});
