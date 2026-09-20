// Temporary random identities and real SQLite/HTTP verify the authentication boundary.
// No external identity provider, call, payment or fabricated success response is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { configuration, createGateway } from '../server.mjs';
import { Store } from '../lib/store.mjs';
import { hash } from '../lib/security.mjs';

async function using(fn) {
 let now=Date.now();const token=randomBytes(32).toString('hex');
 const user={id:randomUUID(),team:'local',role:'operator',tokenHash:hash(token)};
 const config=configuration({OATHRA_USERS_JSON:JSON.stringify([user]),OATHRA_DATA_KEY:randomBytes(32).toString('hex'),OATHRA_DB:':memory:'});
 const store=new Store(':memory:',config.dataKey,()=>now),app=await createGateway(config,{store,env:{}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;config.publicUrl=base;
 const request=(path,{method='GET',cookie,auth,origin,account,body}={})=>fetch(base+'/v1'+path,{method,headers:{...(cookie?{cookie}:{}),...(auth?{authorization:'Bearer '+auth}:{}),...(origin?{origin}:{}),...(account?{'x-oathra-account':account}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const login=async(cookie)=>{const r=await request('/session',{method:'POST',auth:token,origin:base,body:{},cookie});assert.equal(r.status,200);const header=r.headers.get('set-cookie');assert.match(header,/HttpOnly; SameSite=Strict; Max-Age=28800/);return header.split(';')[0]};
 try{await fn({request,login,app,config,store,token,user:config.users[0],base,advance:ms=>{now+=ms}})}finally{await app.close()}
}

test('browser sessions retain authentication and enforce same-origin mutations; bearer SDK stays compatible',()=>using(async f=>{
 assert.equal((await f.request('/bootstrap')).status,401);
 assert.equal((await f.request('/session',{method:'POST',auth:f.token,body:{}})).status,403);
 assert.equal((await f.request('/session',{method:'POST',auth:f.token,origin:'https://outside.invalid',body:{}})).status,403);
 const cookie=await f.login();assert.equal((await f.request('/bootstrap',{cookie})).status,200);
 assert.equal((await f.request('/bootstrap',{auth:f.token})).status,200);
 assert.equal((await f.request('/bootstrap',{cookie,auth:randomUUID()})).status,401);
 for(const origin of [undefined,'https://outside.invalid'])assert.equal((await f.request('/contacts',{method:'POST',cookie,origin,body:{company:'Oathra'}})).status,403);
 assert.equal((await f.request('/contacts',{method:'POST',cookie,origin:f.base,body:{company:'Oathra'}})).status,201);
 assert.equal((await f.request('/bootstrap',{cookie,account:randomUUID()})).status,409);
 assert.equal((await f.request('/bootstrap',{cookie,account:f.user.id})).status,200);
 assert.equal((await f.request('/session',{method:'DELETE',cookie,origin:f.base,account:randomUUID()})).status,409);
 assert.equal((await f.request('/bootstrap',{cookie})).status,200);
 assert.equal((await f.request('/session',{method:'DELETE',cookie,origin:'https://outside.invalid'})).status,403);
 assert.equal((await f.request('/bootstrap',{cookie})).status,200);
 const logout=await f.request('/session',{method:'DELETE',cookie,origin:f.base});assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
 assert.equal((await f.request('/bootstrap',{cookie})).status,401);
}));

test('session rotation, expiry and account credential rotation revoke old sessions',()=>using(async f=>{
 const first=await f.login(),second=await f.login(first);
 assert.notEqual(first,second);assert.equal((await f.request('/bootstrap',{cookie:first})).status,401);
 f.advance(8*3600000);assert.equal((await f.request('/bootstrap',{cookie:second})).status,401);
 const current=await f.login();f.user.tokenHash=hash(randomUUID());
 assert.equal((await f.request('/bootstrap',{cookie:current})).status,401);
}));

test('HTTPS sessions use host-only Secure cookies and reject duplicate cookie values',async()=>{
 const token=randomBytes(32).toString('hex');const config=configuration({OATHRA_USERS_JSON:JSON.stringify([{id:randomUUID(),team:'local',role:'operator',tokenHash:hash(token)}]),OATHRA_DATA_KEY:randomBytes(32).toString('hex'),OATHRA_DB:':memory:',OATHRA_PUBLIC_URL:'https://localhost'});
 const app=await createGateway(config,{env:{}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 try{
  const r=await fetch(base+'/v1/session',{method:'POST',headers:{authorization:'Bearer '+token,origin:config.publicUrl,'content-type':'application/json'},body:'{}'});
  assert.equal(r.status,200);const h=r.headers.get('set-cookie');assert.match(h,/^__Host-oathra_session=/);assert.match(h,/; Secure$/);assert.ok(!h.includes('Domain='));
  const cookie=h.split(';')[0];assert.equal((await fetch(base+'/v1/bootstrap',{headers:{cookie:cookie+'; '+cookie}})).status,401);
 }finally{await app.close()}
});
