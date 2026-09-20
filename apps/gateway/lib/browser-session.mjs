import { assert, hash, random } from './security.mjs';

/** Opaque browser credentials, fixed eight-hour lifetime. Bearer API authentication is unchanged. */
export class BrowserSessions {
  constructor(service) {
    this.service=service;this.store=service.store;
    this.secure=service.config.publicUrl.startsWith('https:');
    this.name=this.secure?'__Host-oathra_session':'oathra_session';
  }
  token(req) {
    const entries=String(req.headers.cookie??'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(this.name+'='));
    if(entries.length!==1)return null;
    const value=entries[0].slice(this.name.length+1);
    return /^[A-Za-z0-9_-]{43}$/.test(value)?value:null;
  }
  sameOrigin(req) { assert(req.headers.origin===this.service.config.publicUrl,'cross_origin_request_denied',403); }
  cookie(value,maxAge) { return `${this.name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${this.secure?'; Secure':''}`; }
  create(req,res,user,expectedVersion) {
    this.sameOrigin(req);
    const passwordVersion=this.service.passwords.version(user.id);
    // Bind the session to the credential actually verified, including across awaited work.
    if(expectedVersion!==undefined)assert(passwordVersion===expectedVersion,'login_changed_retry',409);
    const previous=this.token(req);if(previous)this.store.delKey('browser-session',hash(previous));
    const token=random();
    this.store.setKey('browser-session',hash(token),JSON.stringify({owner:user.id,tokenHash:user.tokenHash,passwordVersion}),8*3600000);
    res.setHeader('set-cookie',this.cookie(token,8*3600));
  }
  current(req) {
    const token=this.token(req),raw=token&&this.store.key('browser-session',hash(token));
    if(!raw)return null;
    const saved=JSON.parse(raw),user=this.service.config.users.find(u=>u.id===saved.owner&&u.tokenHash===saved.tokenHash);
    if((saved.passwordVersion??null)!==this.service.passwords.version(saved.owner))return null;
    return user??null;
  }
  authenticate(req) {
    const user=this.current(req);
    assert(user,'unauthorized',401);
    if(!['GET','HEAD'].includes(req.method))this.sameOrigin(req);
    return user;
  }
  logout(req,res) {
    this.sameOrigin(req);
    const user=this.current(req);
    if(user&&req.headers['x-oathra-account'])assert(req.headers['x-oathra-account']===user.id,'session_account_changed',409);
    const token=this.token(req);if(token)this.store.delKey('browser-session',hash(token));
    res.setHeader('set-cookie',this.cookie('',0));
  }
}
