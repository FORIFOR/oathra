import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Store } from '../lib/store.mjs';
import { verifiedOperatorNumber, definitiveDialRejection } from '../lib/phone.mjs';
import { Followups } from '../lib/followups.mjs';
import { Service } from '../lib/service.mjs';
import { hash } from '../lib/security.mjs';
test('handoff rejects simulator verification and the original callee number',()=>{
 const account={verifiedPhone:'+819000000001',phoneVerificationProvider:'simulator'};
 assert.throws(()=>verifiedOperatorNumber(account,'+819000000002'),/real_verified/);
 assert.throws(()=>verifiedOperatorNumber({...account,phoneVerificationProvider:'twilio-verify'},account.verifiedPhone),/real_verified/);
 assert.equal(verifiedOperatorNumber({...account,phoneVerificationProvider:'twilio-verify'},'+819000000002'),account.verifiedPhone);
});
for(const status of [408,500,502,503,504])test(`carrier HTTP ${status} is uncertain, never safe to redial`,()=>assert.equal(definitiveDialRejection(status),false));
test('carrier authorization rejection is definitive',()=>assert(definitiveDialRejection(401)));
test('deleting a mission also deletes the unassigned channel inbox payload',()=>{
 const store=new Store(':memory:',randomBytes(32).toString('hex'));
 try { const m={id:'mission',owner:'user',sourceKey:'line:event'};store.put('mission',m);store.enqueue('inbox','line:event','_channel',{text:'private'});store.removeMission(m);assert.equal(store.get('inbox','line:event'),null); } finally {store.close();}
});
test('retention never discards an unresolved carrier outcome',()=>{
 const now=Date.now(),store=new Store(':memory:',randomBytes(32).toString('hex'),()=>now);
 try {store.put('mission',{id:'uncertain',owner:'user',status:'UNKNOWN',finishedAt:now-31*86400000});store.prune();assert(store.get('mission','uncertain'));}finally{store.close();}
});
test('changing email during OAuth refresh invalidates follow-up approval before sending',async()=>{
 const store=new Store(':memory:',randomBytes(32).toString('hex'));
 const u={id:'operator',team:'t',role:'admin',tokenHash:hash('test')},service=new Service(store,{users:[u],consentVersion:'v1'});
 try {
  service.saveConsent(u,'v1');const c=service.contact(u,{name:'contact',phone:'+819000000001',email:'first@example.test',relationship:'consented',basis:'requested email'});
  const m={id:'mission',owner:u.id,mode:'live',status:'COMPLETED',revision:1,target:c,result:{verified:{material_send_allowed:true}}};store.put('mission',m);
  const a=new Followups(service,{OATHRA_INTEGRATION_OWNER:u.id,GOOGLE_CLIENT_ID:'test',GOOGLE_CLIENT_SECRET:'test',GOOGLE_REFRESH_TOKEN:'test'});
  const preview=a.preview(u,m.id,{kind:'email',subject:'test',body:'body',contactPermissionBasis:'requested'});
  a.googleToken=async()=>{service.contact(u,{...c,email:'changed@example.test'});return 'token';};let sent=false;a.send=async()=>{sent=true;return {};};
  await assert.rejects(a.execute(u,preview.id,{approvalToken:preview.approvalToken,acknowledged:true},'send'),/recipient_changed/);assert(!sent);
 } finally {store.close();}
});
