import { randomBytes, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { loginEmail, validatePassword } from './password-accounts.mjs';
import { signupLimitReason } from './prerelease.mjs';
import { assert, Fault, hash, mac, random } from './security.mjs';

const LINK_TTL=30*60_000,COOLDOWN=60_000;
const TICKETS='public-auth-ticket',LATEST='public-auth-latest';

function publicHttps(value,{origin=false}={}) {
  try {
    if(typeof value!=='string'||value.length>2048)return null;
    const u=new URL(value);
    if(u.protocol!=='https:'||u.username||u.password||u.hash||u.search||u.port||isIP(u.hostname)||!u.hostname.includes('.')||/^(localhost|127\.)/.test(u.hostname)||/\.(localhost|local|test|invalid|example|internal|trycloudflare\.com)$/.test(u.hostname))return null;
    if(origin&&u.pathname!=='/')return null;
    return origin?u.origin:u.href;
  }catch{return null;}
}

function settings(config,env) {
  const origin=publicHttps(config.publicUrl,{origin:true});
  const from=typeof env.OATHRA_MAIL_FROM==='string'?env.OATHRA_MAIL_FROM.trim():'';
  let sender=false;
  try { sender=from===loginEmail(from)&&!/[\r\n,;]/.test(from); }catch{/* Require a plain sender address, never a recipient-supplied header. */}
  const apiKey=typeof env.RESEND_API_KEY==='string'&&/^re_[A-Za-z0-9_-]+$/.test(env.RESEND_API_KEY)?env.RESEND_API_KEY:null;
  const termsUrl=publicHttps(env.OATHRA_TERMS_URL),privacyUrl=publicHttps(env.OATHRA_PRIVACY_URL);
  const termsVersion=typeof env.OATHRA_TERMS_VERSION==='string'&&/^[A-Za-z0-9._-]{1,80}$/.test(env.OATHRA_TERMS_VERSION)?env.OATHRA_TERMS_VERSION:null;
  const emailReady=config.deployment==='managed'&&!!origin&&sender&&!!apiKey;
  return {origin,from,apiKey,termsUrl,privacyUrl,termsVersion,emailReady,signupReady:emailReady&&env.OATHRA_PUBLIC_SIGNUP==='true'&&!!termsUrl&&!!privacyUrl&&!!termsVersion};
}

/** Public email ownership verification. Only verified links create identities; no free call credit is granted. */
export class PublicAccounts {
  constructor(service,env=process.env) {
    this.service=service;this.store=service.store;this.passwords=service.passwords;
    this.options=settings(service.config,env);
  }
  status() {
    const s=this.options,reason=signupLimitReason(this.store,this.service.config);
    return {signupEnabled:s.signupReady&&!reason,passwordResetEnabled:s.emailReady,termsUrl:s.termsUrl,privacyUrl:s.privacyUrl,termsVersion:s.termsVersion,...(reason?{reason}:{})};
  }
  requireReady(kind) {
    if(kind==='signup'){const reason=signupLimitReason(this.store,this.service.config);assert(!reason,reason,503);}
    assert(kind==='signup'?this.options.signupReady:this.options.emailReady,'public_accounts_unavailable',503);
  }
  identity(kind,email) { return kind+':'+this.passwords.emailKey(email); }
  // Durable limits apply equally to registered and unknown email addresses, before any provider request.
  throttle(ip,email) {
    assert(typeof ip==='string'&&ip.length<=128,'invalid_client_address');
    this.store.tx(()=>{
      for(const [label,value,window,limit]of [['ip',ip,15*60_000,20],['email',email,60*60_000,3],['global','mail',86400_000,300]]) {
        const key=Math.floor(this.store.now()/window)+':'+label+':'+mac(this.store.cipherKey,value);
        const count=Number(this.store.key('public-auth-rate',key)??0);
        assert(count<limit,'public_accounts_rate_limited',429);
        this.store.setKey('public-auth-rate',key,String(count+1),window);
      }
    });
  }
  requestSignup(input,ip) { return this.request('signup',input,ip); }
  requestReset(input,ip) { return this.request('reset',input,ip); }
  async request(kind,input,ip) {
    this.requireReady(kind);
    const email=loginEmail(input?.email);this.throttle(ip,email);
    const identity=this.identity(kind,email),code=random(),key=hash(code);
    const created=this.store.tx(()=>{
      if(this.store.key('public-auth-cooldown',identity))return false;
      const old=this.store.key(LATEST,identity);if(old)this.store.delKey(TICKETS,old);
      const record=this.passwords.byEmail(email);
      // Existing unverified operator email IDs are not silently promoted to trusted recovery addresses.
      const recoverable=record&&record.emailVerifiedAt&&this.service.config.users.some(u=>u.id===record.owner&&u.publicSignup===true);
      const ticket={kind,email,identity,createdAt:this.store.now(),owner:recoverable?record.owner:null,version:recoverable?record.version:null,
        termsVersion:this.options.termsVersion,termsUrl:this.options.termsUrl,privacyUrl:this.options.privacyUrl};
      this.store.setKey(TICKETS,key,this.store.seal(ticket),LINK_TTL);
      this.store.setKey(LATEST,identity,key,LINK_TTL);
      this.store.setKey('public-auth-cooldown',identity,'1',COOLDOWN);
      return true;
    });
    if(!created)return {accepted:true};
    // Always use the same mail path, including for existing signup and unknown reset addresses.
    // This prevents provider latency/errors from disclosing whether an account exists.
    const url=this.options.origin+'/#'+kind+'='+code;
    const message=kind==='signup'
      ?`Oathraへの登録を続けるには、30分以内に次のリンクを開き、パスワードと利用規約への同意を設定してください。\n\n${url}\n\nすでに登録済みの場合は、ログイン画面からパスワードの再設定をご利用ください。`
      :`Oathraのパスワード再設定を依頼された方は、30分以内に次のリンクを開いてください。\n\n${url}\n\nメール所有確認済みのアカウントにのみ利用できます。管理者から発行されたアカウントは管理者へ再設定をご依頼ください。`;
    let outcome='unknown';
    try {
      const response=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(12_000),
        headers:{Authorization:'Bearer '+this.options.apiKey,'Content-Type':'application/json','Idempotency-Key':'oathra-auth-'+key},
        body:JSON.stringify({from:this.options.from,to:[email],subject:kind==='signup'?'Oathra メールアドレスの確認':'Oathra パスワードの再設定',text:message+'\n\n心当たりがなければこのメールを破棄してください。依頼だけでパスワードは変更されません。このリンクを他の人に共有しないでください。'})});
      if(!response.ok){outcome='rejected';await response.body?.cancel();throw new Fault(503,'email_delivery_unavailable');}
      const result=await response.json();
      assert(typeof result.id==='string'&&result.id.length>0,'email_delivery_unconfirmed',503);
      outcome='accepted';
      return {accepted:true};
    }catch(error){
      // Unknown delivery leaves its one-use token valid, so a delivered message remains usable.
      if(error instanceof Fault)throw error;
      throw new Fault(503,'email_delivery_unconfirmed');
    }finally{this.store.audit('public','account.email_requested',key,{kind,outcome});}
  }
  ticket(kind,code) {
    assert(typeof code==='string'&&/^[A-Za-z0-9_-]{43}$/.test(code),'login_link_expired',410);
    const key=hash(code),raw=this.store.key(TICKETS,key);assert(raw,'login_link_expired',410);
    const ticket=this.store.open(raw);
    assert(ticket.kind===kind&&this.store.key(LATEST,ticket.identity)===key,'login_link_expired',410);
    return {key,ticket};
  }
  consume({key,ticket}) { this.store.delKey(TICKETS,key);this.store.delKey(LATEST,ticket.identity); }
  async verifySignup(input,ip) {
    this.requireReady('signup');
    this.passwords.throttle(ip,'public-signup:'+String(input?.code??'').slice(0,64));
    const initial=this.ticket('signup',input?.code),s=this.options;
    assert(input.acceptedTerms===true&&input.termsVersion===s.termsVersion,'accept_current_terms');
    assert(initial.ticket.termsVersion===s.termsVersion&&initial.ticket.termsUrl===s.termsUrl&&initial.ticket.privacyUrl===s.privacyUrl,'terms_changed_request_new_link',409);
    const value=validatePassword(input.password),salt=randomBytes(16).toString('hex'),digest=await this.passwords.digest(value,salt);
    const result=this.store.tx(()=>{
      // Hashing yields; recheck the last available place while holding the write transaction.
      this.requireReady('signup');
      const current=this.ticket('signup',input.code),{email}=current.ticket;
      // Unique email ownership is checked after hashing, inside the same transaction as identity creation.
      assert(!this.passwords.byEmail(email),'account_already_registered',409);
      const id='customer_'+randomUUID(),now=this.store.now(),version=randomUUID();
      const user={id,team:id,role:'operator',tokenHash:hash(random()),publicSignup:true,emailVerifiedAt:now};
      assert(!this.service.config.users.some(u=>u.id===id||u.tokenHash===user.tokenHash),'public_account_conflict',409);
      this.store.db.prepare('INSERT INTO public_users(owner,body) VALUES(?,?)').run(id,this.store.seal(user));
      const record={owner:id,email,salt,digest,version,emailVerifiedAt:now};
      this.store.db.prepare('INSERT INTO password_accounts(owner,email_key,body) VALUES(?,?,?)').run(id,this.passwords.emailKey(email),this.store.seal(record));
      this.store.put('account',{id,owner:id,publicSignup:true,emailVerifiedAt:now,consentVersion:null,verifiedPhone:null,
        termsVersion:s.termsVersion,termsAcceptedAt:now,termsUrl:s.termsUrl,privacyUrl:s.privacyUrl});
      this.consume(current);this.store.audit(id,'account.registered',id,{termsVersion:s.termsVersion});
      return {user,version};
    });
    this.service.config.users.push(result.user);
    return result;
  }
  async reset(input,ip) {
    this.requireReady('reset');
    this.passwords.throttle(ip,'public-reset:'+String(input?.code??'').slice(0,64));
    const initial=this.ticket('reset',input?.code),before=this.passwords.get(initial.ticket.owner);
    assert(before?.emailVerifiedAt&&before.version===initial.ticket.version,'login_link_expired',410);
    const value=validatePassword(input.password),salt=randomBytes(16).toString('hex'),digest=await this.passwords.digest(value,salt);
    return this.store.tx(()=>{
      const current=this.ticket('reset',input.code),old=this.passwords.get(current.ticket.owner);
      assert(old?.emailVerifiedAt&&old.version===current.ticket.version&&old.email===current.ticket.email,'login_link_expired',410);
      const user=this.passwords.user(old.owner);assert(user.publicSignup===true,'login_link_expired',410);
      const version=randomUUID();
      this.store.db.prepare('UPDATE password_accounts SET body=? WHERE owner=?').run(this.store.seal({...old,salt,digest,version}),old.owner);
      this.consume(current);this.store.audit(old.owner,'password.email_reset',old.owner);
      // BrowserSessions binds every cookie to password version; all old cookies now fail authentication.
      return {user,version};
    });
  }
}
