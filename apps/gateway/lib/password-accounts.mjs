import { scrypt, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { assert, hash, mac, random } from './security.mjs';

const derive=promisify(scrypt),PARAMS={N:131072,r:8,p:1,maxmem:256*1024*1024};
const WINDOW=15*60_000,INVITE_TTL=60*60_000;
export function loginEmail(value) {
  assert(typeof value==='string'&&value.length<=254,'invalid_email');
  const email=value.trim().toLowerCase();
  assert(/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(email),'invalid_email');return email;
}
function password(value) {
  assert(typeof value==='string'&&[...value].length>=8&&[...value].length<=128&&Buffer.byteLength(value)<=1024,'password_length');return value;
}

/** Existing operators gain a password login; their immutable owner IDs and API credentials stay intact. */
export class PasswordAccounts {
  constructor(store,config) {
    this.store=store;this.config=config;this.hashing=0;
    this.store.db.exec('CREATE TABLE IF NOT EXISTS password_accounts(owner TEXT PRIMARY KEY,email_key TEXT NOT NULL UNIQUE,body TEXT NOT NULL)');
    this.unknownSalt=randomBytes(16).toString('hex');
  }
  user(owner) { const user=this.config.users.find(u=>u.id===owner);assert(user,'unlinked_account',403);return user; }
  get(owner) { const r=this.store.db.prepare('SELECT body FROM password_accounts WHERE owner=?').get(owner);return r?this.store.open(r.body):null; }
  emailKey(email) { return mac(this.store.cipherKey,'login:'+email); }
  byEmail(email) { const r=this.store.db.prepare('SELECT body FROM password_accounts WHERE email_key=?').get(this.emailKey(email));return r?this.store.open(r.body):null; }
  profile(owner) { const record=this.get(owner);return {email:record?.email??null,passwordLogin:!!record}; }
  version(owner) { return this.get(owner)?.version??null; }
  async digest(value,salt) {
    assert(this.hashing<2,'login_busy',503);this.hashing++;
    try{return (await derive(value,salt,32,PARAMS)).toString('hex')}finally{this.hashing--}
  }
  throttle(ip,identity) {
    const window=Math.floor(this.store.now()/WINDOW);
    this.store.tx(()=>{
      for(const [label,value,limit]of [['ip',ip,60],['identity',identity,10]]) {
        const key=window+':'+label+':'+mac(this.store.cipherKey,value),count=Number(this.store.key('password-rate',key)??0);
        assert(count<limit,'login_rate_limited',429);this.store.setKey('password-rate',key,String(count+1),WINDOW);
      }
    });
  }
  async authenticate(input,ip) {
    let email='';try{email=loginEmail(input.email)}catch{/* Use the same hash work and generic error as an unknown account. */}
    this.throttle(ip,email);
    assert(typeof input.password==='string'&&Buffer.byteLength(input.password)<=1024,'invalid_login',401);
    const record=email?this.byEmail(email):null,digest=await this.digest(input.password,record?.salt??this.unknownSalt);
    const matches=timingSafeEqual(Buffer.from(digest,'hex'),Buffer.from(record?.digest??'0'.repeat(64),'hex'));
    assert(record&&matches&&this.version(record.owner)===record.version,'invalid_login',401);
    const u=this.config.users.find(u=>u.id===record.owner);assert(u,'invalid_login',401);return {user:u,version:record.version};
  }
  issue(owner,{reset=false}={}) {
    const u=this.user(owner),old=this.get(owner);assert(reset||!old,'password_already_configured',409);
    const code=random(),key=hash(code);
    this.store.tx(()=>{
      const previous=this.store.key('password-invite-owner',owner);if(previous)this.store.delKey('password-invite',previous);
      this.store.setKey('password-invite',key,this.store.seal({owner,tokenHash:u.tokenHash,version:old?.version??null}),INVITE_TTL);
      this.store.setKey('password-invite-owner',owner,key,INVITE_TTL);
    });
    return {url:this.config.publicUrl+'/#setup='+code,expiresInSeconds:INVITE_TTL/1000};
  }
  invitation(code) {
    assert(typeof code==='string'&&/^[A-Za-z0-9_-]{43}$/.test(code),'login_link_expired',410);
    const raw=this.store.key('password-invite',hash(code));assert(raw,'login_link_expired',410);
    const invite=this.store.open(raw),u=this.user(invite.owner);
    assert(invite.tokenHash===u.tokenHash&&invite.version===this.version(u.id),'login_link_expired',410);return {invite,u};
  }
  async enroll(input,ip) {
    this.throttle(ip,'setup:'+String(input.code??'').slice(0,64));
    this.invitation(input.code);const email=loginEmail(input.email),value=password(input.password),salt=randomBytes(16).toString('hex'),digest=await this.digest(value,salt);
    return this.store.tx(()=>{
      const {invite,u}=this.invitation(input.code),old=this.get(u.id),used=this.byEmail(email);
      assert(!used||used.owner===u.id,'email_already_registered',409);
      assert(!old||old.email===email,'login_email_mismatch',409);
      const record={owner:u.id,email,salt,digest,version:randomUUID()};
      this.store.db.prepare('INSERT INTO password_accounts VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET email_key=excluded.email_key,body=excluded.body').run(u.id,this.emailKey(email),this.store.seal(record));
      this.store.delKey('password-invite',hash(input.code));this.store.delKey('password-invite-owner',invite.owner);
      this.store.audit(u.id,old?'password.reset':'password.enrolled',u.id);return {user:u,version:record.version};
    });
  }
  async change(u,input,ip) {
    const old=this.get(u.id);assert(old,'password_not_configured',409);
    const authenticated=await this.authenticate({email:old.email,password:input.currentPassword},ip);assert(authenticated.user.id===u.id&&authenticated.version===old.version,'invalid_login',401);
    const value=password(input.newPassword),salt=randomBytes(16).toString('hex'),digest=await this.digest(value,salt);
    return this.store.tx(()=>{
      assert(this.version(u.id)===old.version,'login_changed_retry',409);
      const version=randomUUID();
      this.store.db.prepare('UPDATE password_accounts SET body=? WHERE owner=?').run(this.store.seal({...old,salt,digest,version}),u.id);
      this.store.audit(u.id,'password.changed',u.id);return version;
    });
  }
}
