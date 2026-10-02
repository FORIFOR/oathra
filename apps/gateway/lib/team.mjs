/** A supervisor's view of their own team, and the lists a team works from.
 *
 * A manager (or administrator) sees the calls of everyone in the same team: who was called, how it ended,
 * whether it needs a look. Never another team's. The list carries no phone numbers and no speech; opening
 * one call's record is audited. Contact import and CSV export are the two ends of working from a list. */
import { normalizePhoneNumber } from '../../../packages/contract/dist/index.js';
import { phoneRecord } from './phone-service.mjs';
import { assert } from './security.mjs';

const supervisor = u => assert(['admin', 'manager'].includes(u.role), 'supervisor_required', 403);
const STATUS = { COMPLETED: '確認済み', INCOMPLETE: '未確定', DECLINED: '辞退・連絡停止', FAILED: '発信できず', UNKNOWN: '要照合', CANCELLED: '取消', DRAFT: '下書き' };
const ANSWER = { yes: 'はい', no: 'いいえ', unclear: '要確認', no_answer: '返答なし', not_asked: '' };
const LEVEL = { emergency: '緊急', concern: '要確認', none: '' };

/** One line per call. What a person scanning forty calls needs, and nothing that identifies beyond a name. */
export function callRow(m, { phone = false } = {}) {
  // A wellbeing or scheduled call nobody answered needs a look as much as a worrying answer does.
  const checkIn = m.result?.checkIn ?? null, missed = m.answered === false && (m.schedule ? m.schedule.final !== false : m.phoneRequest?.pace === 'gentle');
  const attention = m.attention?.level ?? (checkIn && checkIn.attention !== 'none' ? checkIn.attention : missed ? 'concern' : null);
  return { id: m.id, owner: m.owner, direction: m.direction === 'inbound' ? 'inbound' : 'outbound', kind: m.kind === 'phone-request' ? 'request' : 'sales', recipient: m.target?.name ?? '',
    ...(phone ? { phone: m.target?.phone ?? '' } : {}), status: m.status, createdAt: new Date(m.createdAt).toISOString(), finishedAt: m.finishedAt ? new Date(m.finishedAt).toISOString() : null,
    answered: typeof m.answered === 'boolean' ? m.answered : null, attention, scheduled: !!m.schedule,
    checkIn: checkIn ? Object.fromEntries(checkIn.items.map(i => [i.topic, i.answer])) : null, durationSeconds: m.billing?.carrier?.durationSeconds ?? null };
}
function teamMissions(service, u) {
  const rows = [];
  for (const row of service.store.db.prepare("SELECT body FROM records WHERE kind='mission' ORDER BY updated DESC").iterate()) { const m = service.store.open(row.body); if (m.team === u.team && m.status !== 'DRAFT') rows.push(m); }
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}
export function teamCalls(service, u, { attention = false, limit = 200 } = {}) {
  supervisor(u); assert(Number.isSafeInteger(limit) && limit >= 1 && limit <= 1000, 'invalid_limit');
  const all = teamMissions(service, u).map(m => callRow(m)), shown = attention ? all.filter(r => r.attention) : all;
  return { team: u.team, total: shown.length, needsAttention: all.filter(r => r.attention).length, calls: shown.slice(0, limit) };
}
/** The full record of a teammate's call, with the number, what was said and what it cost. Opening it is itself recorded. */
export function teamRecord(service, u, id) {
  supervisor(u);
  const m = service.store.get('mission', id); assert(m && m.team === u.team && m.kind === 'phone-request' && m.status !== 'DRAFT', 'not_found', 404);
  if (m.owner !== u.id) service.store.audit(u.id, 'team.record_viewed', m.id, { mission: m.id, owner: m.owner });
  return { ...phoneRecord(service, m), owner: m.owner, attention: m.attention ?? null, checkIn: m.result?.checkIn ?? null, answered: typeof m.answered === 'boolean' ? m.answered : null };
}

/** Counts for the last `days` days in Japan time: how many calls, how many were answered, how they ended, how many need a look. */
export function teamSummary(service, u, days = 7) {
  supervisor(u); assert(Number.isInteger(days) && days >= 1 && days <= 90, 'invalid_days');
  const day = ms => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10), since = service.store.now() - days * 86400_000;
  const empty = () => ({ calls: 0, outbound: 0, inbound: 0, answered: 0, unanswered: 0, completed: 0, declined: 0, failed: 0, unknown: 0, attention: 0, emergency: 0, transferred: 0, seconds: 0 });
  const total = empty(), byDay = {};
  for (const m of teamMissions(service, u)) {
    if (m.createdAt < since) continue;
    const row = callRow(m), bucket = byDay[day(m.createdAt)] ??= empty();
    for (const t of [total, bucket]) {
      t.calls++; t[row.direction]++;
      if (row.answered === true) t.answered++; else if (row.answered === false) t.unanswered++;
      if (m.status === 'COMPLETED') t.completed++; else if (m.status === 'DECLINED') t.declined++; else if (m.status === 'FAILED') t.failed++; else if (m.status === 'UNKNOWN') t.unknown++;
      if (row.attention) t.attention++; if (row.attention === 'emergency') t.emergency++;
      if (m.handoff?.status) t.transferred++;
      t.seconds += row.durationSeconds ?? 0;
    }
  }
  // Of the calls where it is known whether anyone picked up.
  const rate = t => t.answered + t.unanswered ? Math.round(t.answered / (t.answered + t.unanswered) * 1000) / 10 : null;
  return { team: u.team, days, total: { ...total, answerRatePercent: rate(total) }, byDay: Object.keys(byDay).sort().map(date => ({ date, ...byDay[date], answerRatePercent: rate(byDay[date]) })) };
}

// A cell that starts with = + - @ (or a tab/CR) would run as a formula when the file is opened in a spreadsheet.
const cell = value => { const s = String(value ?? ''), safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s; return /[",\r\n]/.test(safe) ? '"' + safe.replaceAll('"', '""') + '"' : safe; };
const when = iso => iso ? new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)) : '';
/** UTF-8 with a BOM, CRLF: opens correctly in Excel on a Japanese desktop. */
export function callsCsv(rows, { phone = false } = {}) {
  const head = ['日時', '担当', '相手', ...(phone ? ['電話番号'] : []), '向き', '種類', '結果', '応答', '要確認', '体調', '食事', '服薬', '睡眠', '相談・困りごと', '通話秒数', '定期', '通話ID'];
  const lines = rows.map(r => [when(r.createdAt), r.owner, r.recipient, ...(phone ? [r.phone] : []), r.direction === 'inbound' ? '着信' : '発信', r.kind === 'sales' ? '営業' : '依頼', STATUS[r.status] ?? '進行中',
    r.answered === null ? '' : r.answered ? 'あり' : 'なし', LEVEL[r.attention ?? 'none'], ...['condition', 'meal', 'medication', 'sleep', 'help'].map(t => r.checkIn ? ANSWER[r.checkIn[t]] ?? '' : ''),
    r.durationSeconds ?? '', r.scheduled ? '定期' : '', r.id]);
  return '﻿' + [head, ...lines].map(line => line.map(cell).join(',')).join('\r\n') + '\r\n';
}
export function teamCallsCsv(service, u) { supervisor(u); service.store.audit(u.id, 'team.calls_exported', u.team, { team: u.team }); return callsCsv(teamMissions(service, u).map(m => callRow(m))); }
export function ownCallsCsv(service, u) {
  const rows = service.store.all('mission', u.id).filter(m => m.status !== 'DRAFT').sort((a, b) => b.createdAt - a.createdAt).map(m => callRow(m, { phone: true }));
  service.store.audit(u.id, 'calls.exported', u.id); return callsCsv(rows, { phone: true });
}

/** Up to 500 rows; each row succeeds or says why not, and a repeat of the same file adds nothing twice. */
export function importContacts(service, u, rows) {
  service.write(u); assert(Array.isArray(rows) && rows.length >= 1 && rows.length <= 500, 'import_1_to_500_rows');
  const existing = new Map(service.store.all('contact', u.id).filter(c => c.phone).map(c => [c.phone, c]));
  // One transaction for the file: 500 separate commits would stall the thread that carries call audio.
  const results = service.store.tx(() => rows.map((row, index) => {
    try {
      assert(row && typeof row === 'object' && !Array.isArray(row) && Object.keys(row).every(k => ['name', 'company', 'phone', 'relationship', 'basis', 'email', 'notes'].includes(k)), 'invalid_contact_row');
      assert(typeof row.phone === 'string' && row.phone.trim(), 'contact_phone_required');
      let number; try { number = normalizePhoneNumber(row.phone); } catch { assert(false, 'invalid_contact_phone'); }
      const same = existing.get(number);
      if (same) return { index, status: 'duplicate', id: same.id };
      const record = service.contact(u, row); existing.set(record.phone, record);
      return { index, status: 'created', id: record.id };
    } catch (error) { return { index, status: 'invalid', error: error.code ?? 'invalid_contact_row' }; }
  }));
  const count = status => results.filter(r => r.status === status).length;
  service.store.audit(u.id, 'contacts.imported', u.id, { created: count('created'), duplicate: count('duplicate'), invalid: count('invalid') });
  return { created: count('created'), duplicate: count('duplicate'), invalid: count('invalid'), results };
}
