/** Standing phone requests.
 *
 * A person approves, once and with bounds, a call that repeats: a daily wellbeing call to a resident, a weekly
 * order check with a supplier. Each occurrence then goes through the same draft, policy, credit and suppression
 * checks as a call approved by hand. Nothing here widens what a call may do: a schedule cannot book, cannot
 * call anyone who is not a saved contact, never redials a call whose state is unknown, and ends for good when
 * the person asks not to be called. Calls leave one at a time, so a morning of thirty calls is a queue, not a burst. */
import { randomUUID } from 'node:crypto';
import { preparePhoneRequest } from '../../../packages/contract/dist/index.js';
import { prepareManagedPhone } from './phone-service.mjs';
import { terminal } from './service.mjs';
import { assert, hash, Fault } from './security.mjs';

const KEYS = ['request', 'times', 'weekdays', 'until', 'retries', 'windowMinutes', 'acknowledged'];
const BUSY = ['QUEUED', 'DIALING', 'ACTIVE', 'VERIFYING', 'CANCEL_REQUESTED'];
const jst = ms => { const t = new Date(ms + 9 * 3600_000); return { date: t.toISOString().slice(0, 10), minutes: t.getUTCHours() * 60 + t.getUTCMinutes(), weekday: t.getUTCDay() }; };
const minutesOf = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const canonical = value => JSON.stringify(value, (_k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);

export class Schedules {
  constructor(service, alerts = null) { this.service = service; this.store = service.store; this.alerts = alerts; }

  /** Explicit, bounded, replayable. Returns the schedule and the most it can do before it ends. */
  create(owner, input, key) {
    const s = this.service; s.write(owner);
    assert(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(k => KEYS.includes(k)), 'invalid_schedule');
    assert(input.acknowledged === true, 'explicit_schedule_approval_required', 403);
    assert(typeof key === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(key), 'idempotency_key_required');
    const id = hash(`schedule:${owner.id}:${key}`).slice(0, 32), fingerprint = hash(canonical(input));
    return this.store.tx(() => {
      const old = this.store.get('schedule', id);
      if (old) { assert(old.fingerprint === fingerprint, 'idempotency_conflict', 409); return this.view(old); }
      assert(s.account(owner).consentVersion === s.config.consentVersion, 'privacy_consent_required', 403);
      let request; try { request = preparePhoneRequest(input.request); } catch { throw new Fault(400, 'invalid_phone_request'); }
      assert(!request.task, 'schedule_cannot_reserve');
      const contact = this.store.list('contact', owner.id).find(c => c.phone === request.phone);
      assert(contact, 'schedule_recipient_must_be_contact');
      assert(!this.store.suppressed(owner.team, request.phone), 'recipient_suppressed', 403);
      const times = input.times;
      assert(Array.isArray(times) && times.length >= 1 && times.length <= 4 && new Set(times).size === times.length && times.every(t => typeof t === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t)), 'invalid_schedule_times');
      const weekdays = input.weekdays ?? [0, 1, 2, 3, 4, 5, 6];
      assert(Array.isArray(weekdays) && weekdays.length >= 1 && new Set(weekdays).size === weekdays.length && weekdays.every(d => Number.isInteger(d) && d >= 0 && d <= 6), 'invalid_schedule_weekdays');
      const until = Date.parse(input.until);
      assert(typeof input.until === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(input.until) && until > this.store.now() && until <= this.store.now() + 92 * 86400_000, 'schedule_end_required_within_92_days');
      const retries = input.retries ?? { count: 0, minutes: 30 };
      assert(retries && Number.isInteger(retries.count) && retries.count >= 0 && retries.count <= 3 && Number.isInteger(retries.minutes) && retries.minutes >= 10 && retries.minutes <= 180 && Object.keys(retries).every(k => ['count', 'minutes'].includes(k)), 'invalid_schedule_retries');
      const windowMinutes = input.windowMinutes ?? 120;
      assert(Number.isInteger(windowMinutes) && windowMinutes >= 30 && windowMinutes <= 240, 'invalid_schedule_window');
      assert(this.store.list('schedule', owner.id, 'ACTIVE').length < 200, 'schedule_limit', 429);
      const schedule = { id, owner: owner.id, team: owner.team, status: 'ACTIVE', fingerprint, request, contactId: contact.id, times: [...times].sort(), weekdays: [...weekdays].sort(), until,
        retries: { count: retries.count, minutes: retries.minutes }, windowMinutes, consentVersion: s.config.consentVersion, createdAt: this.store.now() };
      this.store.put('schedule', schedule);
      this.store.audit(owner.id, 'schedule.created', id, { schedule: id, target: this.store.phoneRef(request.phone), times: schedule.times, weekdays: schedule.weekdays, until: input.until, retries: schedule.retries });
      return this.view(schedule);
    });
  }
  /** What the person sees: never the fingerprint; with today's and the latest runs. */
  view(schedule) {
    const runs = this.store.all('schedule-run', schedule.owner).filter(r => r.scheduleId === schedule.id).sort((a, b) => a.id < b.id ? 1 : -1).slice(0, 14);
    const days = Math.max(0, Math.ceil((schedule.until - this.store.now()) / 86400_000));
    const { fingerprint, ...rest } = schedule;
    return { ...rest, until: new Date(schedule.until).toISOString(), runs: runs.map(r => ({ date: r.date, time: r.time, state: r.state, reason: r.reason ?? null, attempts: r.attempts.length, missionId: r.attempts.at(-1)?.missionId ?? null })),
      // An upper bound for the approval screen, not a forecast: every listed time on every remaining day, with every retry.
      bounds: { callsUpperBound: days * schedule.times.length * (1 + schedule.retries.count) } };
  }
  list(owner) { return this.store.all('schedule', owner.id).sort((a, b) => b.createdAt - a.createdAt).map(x => this.view(x)); }
  set(owner, id, status) {
    this.service.write(owner); assert(['ACTIVE', 'PAUSED', 'ENDED'].includes(status), 'invalid_schedule_status');
    return this.store.tx(() => {
      const schedule = this.service.own('schedule', id, owner);
      assert(schedule.status !== 'ENDED', 'schedule_ended', 409);
      // Resuming is a fresh decision by the person, so it is checked like one.
      if (status === 'ACTIVE') { assert(schedule.until > this.store.now(), 'schedule_ended', 409); assert(!this.store.suppressed(owner.team, schedule.request.phone), 'recipient_suppressed', 403); }
      schedule.status = status; if (status === 'ENDED') schedule.endedReason = 'ended_by_owner';
      this.store.put('schedule', schedule); this.store.audit(owner.id, 'schedule.' + status.toLowerCase(), id, { schedule: id });
      return this.view(schedule);
    });
  }

  end(schedule, reason) { schedule.status = 'ENDED'; schedule.endedReason = reason; this.store.put('schedule', schedule); this.store.audit(schedule.owner, 'schedule.ended', schedule.id, { schedule: schedule.id, reason }); }
  note(schedule, run, level = 'concern') { this.alerts?.raise({ id: run.id, owner: schedule.owner, team: schedule.team, origin: null, target: { name: schedule.request.name } }, 'schedule', level, { categories: [run.reason ?? run.state] }); }

  /** Starts what is due, only onto a free line. Safe to call as often as the worker likes. */
  tick() {
    const now = this.store.now(), today = jst(now);
    // A free line, of however many the operator allowed. Each dispatch below takes one.
    let inUse = 0; const lines = Math.max(1, this.service.config.maxConcurrentCalls ?? 1);
    this.store.some('mission', x => { if (BUSY.includes(x.status)) inUse++; return false; });
    let idle = inUse < lines;
    for (const schedule of this.store.list('schedule', undefined, 'ACTIVE').sort((a, b) => a.createdAt - b.createdAt)) {
      if (now >= schedule.until) { this.end(schedule, 'reached_end_date'); continue; }
      const runs = this.store.all('schedule-run', schedule.owner).filter(r => r.scheduleId === schedule.id);
      // 1. Settle or retry what was started.
      for (const run of runs.filter(r => r.state === 'RUNNING')) {
        const m = this.store.get('mission', run.attempts.at(-1).missionId);
        if (m && !terminal(m.status)) continue;
        const done = (state, reason) => { run.state = state; if (reason) run.reason = reason; this.store.put('schedule-run', run); };
        if (!m) { done('FAILED', 'record_deleted'); continue; }
        // An unknown state may be a call that connected. It is never redialled; a person reconciles it.
        if (m.status === 'UNKNOWN' || m.stopNeedsReconciliation) { done('FAILED', 'unknown_state_needs_reconciliation'); this.note(schedule, run); continue; }
        if (m.status === 'DECLINED' || this.store.suppressed(schedule.team, schedule.request.phone)) { done('DECLINED'); this.end(schedule, 'recipient_asked_not_to_be_called'); break; }
        if (m.status === 'CANCELLED') { done('CANCELLED'); continue; }
        if (m.answered) { done('ANSWERED'); continue; }
        if (run.attempts.length > schedule.retries.count || jst(now).date !== run.date) { done('UNANSWERED'); continue; }
        if (now < (m.finishedAt ?? now) + schedule.retries.minutes * 60_000 || !idle) continue;
        if (this.dispatch(schedule, run)) idle = ++inUse < lines;
      }
      if (schedule.status !== 'ACTIVE' || !schedule.weekdays.includes(today.weekday)) continue;
      // 2. Start what is due. A time that passed while the line was busy or the service was down is skipped, not made up late.
      for (const time of schedule.times) {
        const id = `${schedule.id}:${today.date}:${time}`, at = minutesOf(time);
        if (today.minutes < at || runs.some(r => r.id === id) || this.store.get('schedule-run', id)) continue;
        const run = { id, owner: schedule.owner, scheduleId: schedule.id, date: today.date, time, attempts: [], state: 'RUNNING' };
        // A schedule made at 10:00 does not owe the 09:00 call of that day.
        const createdToday = jst(schedule.createdAt), predates = createdToday.date === today.date && createdToday.minutes > at;
        if (predates) continue;
        if (today.minutes >= at + schedule.windowMinutes) { run.state = 'SKIPPED'; run.reason = 'window_passed'; this.store.put('schedule-run', run); this.note(schedule, run); continue; }
        if (!idle) continue;
        if (this.dispatch(schedule, run)) idle = ++inUse < lines;
      }
    }
  }
  /** One occurrence attempt through the ordinary approval path. Returns true when a call was queued. */
  dispatch(schedule, run) {
    const s = this.service, attempt = run.attempts.length;
    try {
      const m = this.store.tx(() => {
        const owner = s.user(schedule.owner); s.write(owner);
        assert(schedule.consentVersion === s.config.consentVersion && s.account(owner).consentVersion === s.config.consentVersion, 'privacy_consent_required', 403);
        assert(this.store.list('contact', owner.id).some(c => c.id === schedule.contactId && c.phone === schedule.request.phone), 'contact_changed_review_again', 409);
        const { schemaVersion, kind, ...fields } = schedule.request;
        const draft = prepareManagedPhone(s, owner, fields);
        draft.schedule = { id: schedule.id, run: run.id, attempt, final: attempt >= schedule.retries.count };
        this.store.put('mission', draft);
        const { approvalToken } = s.review(owner, draft.id);
        s.startTx(owner, approvalToken, `schedule:${run.id}:${attempt}`, true, draft.id);
        run.attempts.push({ missionId: draft.id, at: this.store.now() }); run.state = 'RUNNING'; this.store.put('schedule-run', run);
        this.store.audit(owner.id, 'schedule.dispatched', draft.id, { schedule: schedule.id, run: run.id, attempt, mission: draft.id });
        return draft;
      });
      return !!m;
    } catch (error) {
      const reason = error.code ?? 'dispatch_failed';
      // Someone else's call to the same number, or a busy moment, is not a failure of the day: try again next tick.
      if (reason === 'recipient_has_active_call') return false;
      run.state = attempt ? 'UNANSWERED' : 'FAILED'; run.reason = reason; this.store.put('schedule-run', run);
      if (['recipient_suppressed', 'contact_changed_review_again', 'privacy_consent_required', 'unauthorized', 'read_only_account'].includes(reason)) this.end(schedule, reason);
      this.note(schedule, run);
      return false;
    }
  }
}
