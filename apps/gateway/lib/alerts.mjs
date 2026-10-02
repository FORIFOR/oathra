/** Staff alerts.
 *
 * A call can hear something a person must read now (a fall, 「助けて」), or reach nobody when someone was
 * expected to answer. The alert says that a look is needed and where; it does not carry what was said unless
 * the operator opted in, because the words are health information. It never diagnoses and never claims help
 * was sent. Delivery is a signed HTTPS POST to one operator-configured endpoint, retried by the worker. */
import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { assert, publicIPv4 } from './security.mjs';

const LEVELS = ['notice', 'concern', 'emergency'];
export const worse = (a, b) => LEVELS.indexOf(a) >= LEVELS.indexOf(b) ? a : b;

/** `null` when no endpoint is configured. A half-configured endpoint stops the service from starting. */
export function alertConfiguration(env = {}) {
  if (!env.OATHRA_ALERT_WEBHOOK_URL) return null;
  let url; try { url = new URL(env.OATHRA_ALERT_WEBHOOK_URL); } catch { assert(false, 'configure_alert_webhook_url', 500); }
  assert(url.protocol === 'https:' && !url.username && !url.password && !url.hash, 'configure_alert_webhook_url', 500);
  assert(typeof env.OATHRA_ALERT_WEBHOOK_SECRET === 'string' && env.OATHRA_ALERT_WEBHOOK_SECRET.length >= 32, 'configure_alert_webhook_secret', 500);
  return { url: url.href, secret: env.OATHRA_ALERT_WEBHOOK_SECRET, includeQuotes: env.OATHRA_ALERT_INCLUDE_QUOTES === 'true' };
}
export function alertSignature(secret, timestamp, body) { return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`; }

const TEXT = {
  distress: m => `【要確認】${m.target.name}さんとの電話で、体調や安全に関わる発言がありました。内容をすぐに確認してください。`,
  unanswered: m => `【要確認】${m.target.name}さんへの電話に応答がありませんでした。`,
  callback: () => '【着信】つながらなかった方から、折り返しのご希望がありました。「折り返しの依頼」を確認してください。',
  inbound: m => `【着信】${m.target.name}さんからお電話がありました。用件を確認してください。`,
  batch: m => `【要確認】${m.target.name}への電話を一時停止しました。残高や上限を確認してください。`,
  schedule: m => `【要確認】${m.target.name}さんへの定期の電話を、予定どおりに発信できませんでした。`,
  checkin: m => `【要確認】${m.target.name}さんへの電話で、確認が必要な回答がありました。`,
};

export class Alerts {
  constructor(service, config, { fetchImpl = null, resolve = lookup } = {}) { this.service = service; this.store = service.store; this.config = config; this.fetchImpl = fetchImpl; this.resolve = resolve; }
  /** Records that a human should look, once per call, reason and level; queues delivery where configured. */
  raise(m, reason, level, detail = {}) {
    assert(TEXT[reason] && LEVELS.includes(level), 'invalid_alert');
    const id = `${m.id}:${reason}:${level}`;
    return this.store.tx(() => {
      if (this.store.key('alert', id)) return false;
      this.store.setKey('alert', id, 'raised', 90 * 86400_000);
      this.store.audit(m.owner, 'call.alert', m.id, { mission: m.id, reason, level, categories: detail.categories ?? [] });
      // The person who asked, on the channel they asked from. No quoted speech: a chat app is not the record.
      this.service.notify(m, TEXT[reason](m));
      if (this.config) this.store.enqueue('alert', id, m.owner, { id, reason, level, mission: m.id, team: m.team ?? null, recipient: m.target.name, at: this.store.now(),
        categories: detail.categories ?? [], ...(this.config.includeQuotes && detail.quotes?.length ? { quotes: detail.quotes.slice(0, 5).map(q => String(q).slice(0, 300)) } : {}) }, { priority: true });
      return true;
    });
  }
  async send(job) {
    const config = this.config; assert(config, 'alert_webhook_not_configured', 409);
    const url = new URL(config.url), addresses = await this.resolve(url.hostname, { all: true, family: 4 });
    assert(addresses.length > 0 && addresses.every(a => publicIPv4(a.address)), 'private_address_blocked');
    const p = job.payload, body = JSON.stringify({ type: 'oathra.alert', version: 1, ...p, at: new Date(p.at).toISOString(),
      message: TEXT[p.reason]({ target: { name: p.recipient } }), reportUrl: `${this.service.config.publicUrl}/app/#/call/${p.mission}` });
    const timestamp = Math.floor(this.store.now() / 1000);
    const headers = { 'content-type': 'application/json', 'user-agent': 'Oathra-Alert/1', 'x-oathra-alert-id': p.id, 'x-oathra-signature': alertSignature(config.secret, timestamp, body) };
    // The connection goes to the address that was just checked, so a name that re-resolves to a private one is never followed.
    const ok = this.fetchImpl ? (await this.fetchImpl(config.url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000), headers, body })).ok : await pinnedPost(url, addresses[0].address, headers, body);
    assert(ok, 'alert_delivery_not_accepted', 502);
  }
}
function pinnedPost(url, address, headers, body) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST', headers: { ...headers, 'content-length': Buffer.byteLength(body) }, timeout: 10_000, lookup: (_host, options, cb) => options?.all ? cb(null, [{ address, family: 4 }]) : cb(null, address, 4) },
      res => { res.resume(); res.on('end', () => resolve(res.statusCode >= 200 && res.statusCode < 300)); res.on('error', reject); });
    // `timeout` is idle time; an endpoint that trickles bytes would hold the connection for ever without a total deadline.
    const deadline = setTimeout(() => req.destroy(new Error('alert_timeout')), 12_000); deadline.unref?.();
    req.on('close', () => clearTimeout(deadline));
    req.on('timeout', () => req.destroy(new Error('alert_timeout'))); req.on('error', reject); req.end(body);
  });
}
