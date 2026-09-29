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

test('local open: no sign-in only for the simulator, from this computer, to a localhost address; writes stay same-origin',()=>using(async f=>{
 const { request: raw } = await import('node:http');
 const get=(host,{method='GET',origin,body}={})=>new Promise((resolve,reject)=>{const r=raw({host:'127.0.0.1',port:new URL(f.base).port,path:'/v1/bootstrap',method,headers:{host,...(origin?{origin}:{}),...(body?{'content-type':'application/json'}:{})}},res=>{res.resume();resolve(res.statusCode)});r.on('error',reject);r.end(body)});
 const host=new URL(f.base).host;
 assert.equal(await get(host),401,'off unless OATHRA_LOCAL_OPEN=true');
 f.config.localOpen=true;
 assert.equal(await get(host),200);
 assert.equal(await get('localhost:'+new URL(f.base).port),200);
 assert.equal(await get('oathra.example.com'),401,'a public (or rebound) Host name signs nobody in');
 assert.equal((await f.request('/contacts',{method:'POST',body:{company:'Oathra'}})).status,403,'a write without this page as its origin is refused');
 assert.equal((await f.request('/contacts',{method:'POST',origin:f.base,body:{company:'Oathra'}})).status,201);
 const mode=f.config.mode;f.config.mode='live';assert.equal(await get(host),401,'never when the server can dial');f.config.mode=mode;
 assert.equal((await f.request('/bootstrap',{cookie:'oathra_session=stale'})).status,401,'a session cookie is judged as a session, not waved through');
}));

test('設定 issues a one-time email login code for the signed-in user; the code sets email and password once',()=>using(async f=>{
 const r=await f.request('/account/password-link',{method:'POST',auth:f.token,body:{}});assert.equal(r.status,200);
 const {code,expiresInSeconds}=await r.json();assert.match(code,/^[A-Za-z0-9_-]{43}$/);assert.ok(expiresInSeconds>0);
 const setup=body=>f.request('/auth/setup',{method:'POST',origin:f.base,body});
 assert.equal((await setup({code,email:'owner@example.com',password:'short'})).status,400);
 assert.equal((await setup({code,email:'owner@example.com',password:'correct horse 9'})).status,200);
 assert.equal((await setup({code,email:'owner@example.com',password:'correct horse 9'})).status,410,'the code works once');
 const login=await f.request('/auth/login',{method:'POST',origin:f.base,body:{email:'owner@example.com',password:'correct horse 9'}});assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const boot=await (await f.request('/bootstrap',{cookie})).json();assert.equal(boot.login.email,'owner@example.com');assert.equal(boot.user.id,f.user.id);
}));
