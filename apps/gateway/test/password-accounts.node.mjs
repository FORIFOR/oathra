// Temporary random identities isolate the real credential/HTTP/SQLite boundary; no mail or provider stubs.
import test from 'node:test';import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {BrowserSessions} from '../lib/browser-session.mjs';
import {ServerResponse} from 'node:http';
import {createGateway,configuration} from '../server.mjs';import {hash} from '../lib/security.mjs';
async function fixture(fn){
 const dir=mkdtempSync(join(tmpdir(),'oathra-login-')),token=randomBytes(32).toString('hex'),email=randomUUID()+'@example.invalid',password=randomBytes(24).toString('base64url');
 const user={id:randomUUID(),team:'local',role:'admin',tokenHash:hash(token)},other={id:randomUUID(),team:'local',role:'operator',tokenHash:hash(randomUUID())};
 const config=configuration({OATHRA_USERS_JSON:JSON.stringify([user,other]),OATHRA_DATA_KEY:randomBytes(32).toString('hex'),OATHRA_DB:join(dir,'db.sqlite'),OATHRA_DEPLOYMENT:'managed',OATHRA_CREDITS_PER_CALL:'3'});
 const app=await createGateway(config,{env:{}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;config.publicUrl=base;
 const req=async(path,data,opts={})=>{const r=await fetch(base+'/v1'+path,{method:data?'POST':'GET',headers:{origin:base,'content-type':'application/json',...opts.headers},...(data?{body:JSON.stringify(data)}:{})});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0],header:r.headers.get('set-cookie')}};
 const code=(owner=user.id,options)=>new URL(app.service.passwords.issue(owner,options).url).hash.slice(7);
 try{await fn({app,config,base,req,code,user,other,token,email,password})}finally{await app.close();rmSync(dir,{recursive:true,force:true})}
}
test('invite enrollment preserves owner data, generic login, cookies, password change and API compatibility',()=>fixture(async f=>{
 const {app,req,user,token,email,password,code}=f;
 const contact=app.service.contact(user,{company:'Oathra'});app.service.credits.grant(user,user.id,9,randomUUID(),'Local identity migration verification');
 const bearer={headers:{authorization:'Bearer '+token}},previous=await req('/session',{},bearer);
 const setup=await req('/auth/setup',{code:code(),email:email.toUpperCase(),password});assert.equal(setup.status,200);assert.match(setup.header,/HttpOnly; SameSite=Strict; Max-Age=28800/);
 assert.equal((await req('/bootstrap',null,{headers:{cookie:previous.cookie}})).status,401);
 let boot=await req('/bootstrap',null,{headers:{cookie:setup.cookie}});assert.equal(boot.body.user.id,user.id);assert.equal(boot.body.login.email,email);assert.equal(boot.body.credits.available,9);assert.equal(boot.body.contacts[0].id,contact.id);
 const record=app.service.passwords.get(user.id);assert.notEqual(record.digest,password);assert.equal(record.salt.length,32);assert.ok(!JSON.stringify(app.store.db.prepare('SELECT * FROM password_accounts').all()).includes(email));assert.ok(!JSON.stringify(record).includes(password));
 const bad=await req('/auth/login',{email,password:'wrong'}),unknown=await req('/auth/login',{email:randomUUID()+'@example.invalid',password:'wrong'});assert.equal(bad.status,401);assert.equal(unknown.status,401);assert.equal(bad.body.error,unknown.body.error);
 assert.equal((await req('/auth/login',{email:email+'x'.repeat(255),password})).status,401);
 const login=await req('/auth/login',{email,password});assert.equal(login.status,200);
 const changed=await req('/auth/password',{currentPassword:password,newPassword:password+'new'},{headers:{cookie:login.cookie}});assert.equal(changed.status,200);
 assert.equal((await req('/bootstrap',null,{headers:{cookie:setup.cookie}})).status,401);assert.equal((await req('/bootstrap',null,{headers:{cookie:login.cookie}})).status,401);
 assert.equal((await req('/bootstrap',null,{headers:{cookie:changed.cookie}})).status,200);
 assert.equal((await req('/auth/login',{email,password})).status,401);assert.equal((await req('/auth/login',{email,password:password+'new'})).status,200);
 boot=await req('/bootstrap',null,bearer);assert.equal(boot.status,200);assert.equal(boot.body.credits.available,9);assert.equal(boot.body.contacts[0].id,contact.id);
}));
test('setup links are expiring, replaced, one-use, owner-bound and reset cannot change email',()=>fixture(async f=>{
 const {app,req,code,email,password,user,other}=f;
 const replaced=code(),current=code();assert.equal((await req('/auth/setup',{code:replaced,email,password})).status,410);
 assert.equal((await req('/auth/setup',{code:current,email,password:'short'})).body.error,'password_length');
 const parallel=await Promise.all([req('/auth/setup',{code:current,email,password}),req('/auth/setup',{code:current,email,password})]);assert.deepEqual(parallel.map(r=>r.status).sort(),[200,410]);
 assert.equal((await req('/auth/setup',{code:current,email,password})).status,410);assert.throws(()=>code(),/password_already_configured/);
 const duplicate=code(other.id);assert.equal((await req('/auth/setup',{code:duplicate,email,password})).status,409);assert.equal(app.service.passwords.get(other.id),null);
 const reset=code(user.id,{reset:true});assert.equal((await req('/auth/setup',{code:reset,email:randomUUID()+'@example.invalid',password})).body.error,'login_email_mismatch');
 const oldLogin=await req('/auth/login',{email,password});assert.equal((await req('/auth/setup',{code:reset,email,password:password+'reset'})).status,200);
 assert.equal((await req('/bootstrap',null,{headers:{cookie:oldLogin.cookie}})).status,401);
 const expired=code(user.id,{reset:true});app.store.db.prepare("UPDATE keys SET expires=0 WHERE scope='password-invite'").run();assert.equal((await req('/auth/setup',{code:expired,email,password})).status,410);
 const rotated=code(user.id,{reset:true});f.config.users.find(u=>u.id===user.id).tokenHash=hash(randomUUID());assert.equal((await req('/auth/setup',{code:rotated,email,password})).status,410);
}));
test('login routes enforce origin, shape and authentication; throttling is persisted',()=>fixture(async f=>{
 const {req,code,email,password,app,user}=f;const invite=code();
 assert.equal((await req('/auth/setup',{code:invite,email,password},{headers:{origin:'https://example.invalid'}})).status,403);
 assert.equal((await req('/auth/login',{email,password},{headers:{origin:''}})).status,403);
 assert.equal((await req('/auth/setup',[])).status,400);assert.equal((await req('/auth/password',{currentPassword:password,newPassword:password})).status,401);
 assert.equal((await req('/auth/setup',{code:invite,email,password,owner:'unrelated',role:'viewer'})).status,200);assert.equal(app.service.passwords.get(user.id).owner,user.id);
 // Signing in correctly any number of times leaves the account's failure budget untouched.
 for(let i=0;i<12;i++)assert.equal((await req('/auth/login',{email,password})).status,200);
 for(let i=0;i<10;i++)assert.equal((await req('/auth/login',{email,password:'wrong'})).status,401);
 assert.equal((await req('/auth/login',{email,password})).status,429);
 assert.ok(app.store.db.prepare("SELECT COUNT(*) AS n FROM keys WHERE scope='password-rate'").get().n>0);
}));

test('a password change cannot upgrade an earlier verified credential into a new valid session',()=>fixture(async f=>{
 const {app,req,code,email,password,user}=f;await req('/auth/setup',{code:code(),email,password});
 const verified=await app.service.passwords.authenticate({email,password},'local-test');
 await app.service.passwords.change(user,{currentPassword:password,newPassword:password+'changed'},'local-test');
 const sessions=new BrowserSessions(app.service),request={headers:{origin:f.base}},response=new ServerResponse({method:'POST'});
 assert.throws(()=>sessions.create(request,response,verified.user,verified.version),/login_changed_retry/);
 assert.equal(response.getHeader('set-cookie'),undefined);
}));

test('passwords accept 8–128 code points across setup, change and reset while rejecting out-of-range values',()=>fixture(async f=>{
 const {app,req,code,email,user,other}=f,invite=code();
 const initial=randomBytes(6).toString('base64url'),changed=randomBytes(6).toString('base64url');
 const reset='🌸'.repeat(4)+randomBytes(2).toString('hex');
 for(const invalid of [initial.slice(0,7),'🌸'.repeat(7),initial.repeat(16)+'x']){
  const rejected=await req('/auth/setup',{code:invite,email,password:invalid});
  assert.equal(rejected.status,400);assert.equal(rejected.body.error,'password_length');assert.equal(app.service.passwords.get(user.id),null);
 }
 const setup=await req('/auth/setup',{code:invite,email,password:initial});assert.equal(setup.status,200);
 assert.equal((await req('/auth/login',{email,password:initial})).status,200);
 const shortChange=await req('/auth/password',{currentPassword:initial,newPassword:changed.slice(0,7)},{headers:{cookie:setup.cookie}});
 assert.equal(shortChange.status,400);assert.equal(shortChange.body.error,'password_length');
 const change=await req('/auth/password',{currentPassword:initial,newPassword:changed},{headers:{cookie:setup.cookie}});assert.equal(change.status,200);
 assert.equal((await req('/auth/login',{email,password:initial})).status,401);assert.equal((await req('/auth/login',{email,password:changed})).status,200);
 const resetCode=code(user.id,{reset:true});
 const shortReset=await req('/auth/setup',{code:resetCode,email,password:changed.slice(0,7)});assert.equal(shortReset.status,400);assert.equal(shortReset.body.error,'password_length');
 assert.equal((await req('/auth/setup',{code:resetCode,email,password:reset})).status,200);
 assert.equal((await req('/auth/login',{email,password:reset})).status,200);
 assert.equal((await req('/bootstrap',null,{headers:{cookie:change.cookie}})).status,401);
 assert.equal((await req('/auth/setup',{code:code(other.id),email:randomUUID()+'@example.invalid',password:initial.repeat(16)})).status,200);
}));
