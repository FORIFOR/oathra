import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';

export class Fault extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
export const assert = (ok, code, status = 400) => { if (!ok) throw new Fault(status, code); };
export const hash = value => createHash('sha256').update(value).digest('hex');
export const random = () => randomBytes(32).toString('base64url');
export const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const mac = (secret, value) => createHmac('sha256', secret).update(value).digest('base64url');
export function text(value, max = 2000) {
  assert(typeof value === 'string' && value.trim().length > 0 && value.length <= max, 'invalid_text');
  return value.trim();
}
export function phone(value) {
  const p = text(value, 30).replace(/[ ()-]/g, '');
  assert(/^\+[1-9]\d{7,14}$/.test(p), 'phone_must_be_e164'); return p;
}
export function signature(kind, raw, headers, secret, now = Date.now()) {
  if (!secret) return false;
  if (kind === 'line') return equal(createHmac('sha256', secret).update(raw).digest('base64'), headers['x-line-signature']);
  const ts = headers['x-slack-request-timestamp'];
  if (!/^\d+$/.test(ts ?? '') || Math.abs(now / 1000 - Number(ts)) > 300) return false;
  return equal('v0=' + createHmac('sha256', secret).update(`v0:${ts}:`).update(raw).digest('hex'), headers['x-slack-signature']);
}
export function twilioSignature(url, params, signature, secret) {
  const base = url + Object.keys(params).sort().map(k => k + params[k]).join('');
  return !!secret && equal(createHmac('sha1', secret).update(base).digest('base64'), signature);
}
export function issue(secret, claim, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ ...claim, exp: now + 300_000, nonce: random() })).toString('base64url');
  return `${body}.${mac(secret, body)}`;
}
export function verify(secret, token, expected, now = Date.now()) {
  assert(typeof token === 'string' && token.length < 4000, 'invalid_approval', 403);
  const [body, sig, extra] = token.split('.');
  assert(!extra && equal(mac(secret, body ?? ''), sig), 'invalid_approval', 403);
  let claim; try { claim = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { throw new Fault(403, 'invalid_approval'); }
  assert(Number.isFinite(claim.exp) && claim.exp > now, 'approval_expired', 409);
  for (const [key, value] of Object.entries(expected)) assert(claim[key] === value, 'approval_scope_mismatch', 403);
  return claim;
}
export function publicIPv4(address) {
  if (isIP(address) !== 4) return false; // Fail closed on IPv6, including mapped private addresses.
  const [a, b, c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || b === 2)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0 && c === 113));
}
/** HTTPS-only, no redirects, DNS pinned to a public IPv4. Remote text is untrusted data, never instructions. */
export async function importProduct(input) {
  const url = new URL(text(input, 2048));
  assert(url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443'), 'unsafe_product_url');
  const addresses = await lookup(url.hostname, { all: true, family: 4 });
  assert(addresses.length > 0 && addresses.every(a => publicIPv4(a.address)), 'private_address_blocked');
  const html = await new Promise((resolve, reject) => {
    const req = request(url, { headers: { 'user-agent': 'Oathra-Product-Import/1.0', accept: 'text/html,text/plain' },
      lookup: (_host, options, cb) => options?.all ? cb(null, [addresses[0]]) : cb(null, addresses[0].address, 4) }, res => {
      if (res.statusCode !== 200 || !/^(text\/html|text\/plain)/i.test(res.headers['content-type'] ?? '')) { res.resume(); reject(new Fault(400, 'product_page_unavailable')); return; }
      let size = 0; const chunks = [];
      res.on('data', chunk => { size += chunk.length; if (size > 512_000) req.destroy(new Fault(413, 'product_page_too_large')); else chunks.push(chunk); });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); res.on('error', reject);
    });
    const deadline = setTimeout(() => req.destroy(new Fault(408, 'product_page_timeout')), 8000);
    req.once('close', () => clearTimeout(deadline)); req.on('error', reject); req.end();
  });
  const content = html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ')
    .replace(/&(?:nbsp|amp|lt|gt|quot);/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 12000);
  return { source: url.href, content, reviewed: false };
}
export async function jsonFetch(url, options = {}) {
  const res = await fetch(url, { ...options, signal: options.signal ?? AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Fault(502, `provider_http_${res.status}`); // Never leak provider body or credentials.
  return res.status === 204 ? {} : res.json();
}
