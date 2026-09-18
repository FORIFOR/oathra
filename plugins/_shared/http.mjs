import { createHmac, timingSafeEqual } from 'node:crypto';
export function check(ok,code,status=400) { if(!ok) { const e=new Error(code);e.code=code;e.status=status;throw e; } }
export function string(value,max=12000) { check(typeof value==='string' && value.trim().length>0 && value.length<=max,'invalid_text');return value.trim(); }
export function equal(a,b) { if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y); }
export function hmac(secret,bytes,encoding='base64') { return createHmac('sha256',secret).update(bytes).digest(encoding); }
export async function jsonFetch(fetchImpl,url,init={}) { const r=await fetchImpl(url,{...init,signal:init.signal??AbortSignal.timeout(12000),redirect:'error'});check(r.ok,'provider_request_failed',502);return r.json(); }
export async function write(fetchImpl,url,init,signal) {
 const r=await fetchImpl(url,{...init,method:'POST',signal:signal??AbortSignal.timeout(12000),redirect:'error'});
 if(!r.ok){const e=new Error('followup_provider_error');e.definitive=r.status>=400&&r.status<500&&r.status!==408;throw e;}return r.json();
}
