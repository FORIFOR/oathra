import { describe, expect, it } from 'vitest';
import { DemoSession, MODELS, ORIGINAL_RESERVATION, SCENARIOS, VENUES, type DemoKind, type DemoScenario } from './use-case-model.js';

const kinds: DemoKind[] = ['restaurant', 'stock', 'modify'];

function finish(session: DemoSession) {
  expect(session.review()).toBe(true);
  expect(session.approve()).toBe(true);
  let remaining = 25;
  while (session.stage === 'calling' && remaining-- > 0) expect(session.next(session.snapshot().step)).toBe(true);
  expect(remaining).toBeGreaterThan(0);
  return session.snapshot();
}

describe('three synthetic vertical flows', () => {
  it.each(kinds)('%s completes only from the production evidence verdict', kind => {
    const snapshot = finish(new DemoSession(kind));
    expect(snapshot.result?.status, JSON.stringify(snapshot.result)).toBe('completed');
    expect(snapshot.result?.fields.confirmed).toBe(true);
    expect(snapshot.result?.evidence.some(e => e.field === 'confirmed' && e.source === 'callee' && e.verified)).toBe(true);
    expect(snapshot.result?.missing).toEqual([]);
    expect(snapshot.approval?.maxCharge).toBe(0);
    expect(snapshot.approval?.purchaseObligation).toBe(false);
    expect(snapshot.target.number).toMatch(/^SIM-\d{3}$/);
  });

  it('uses only exact whitelisted synthetic models and checks their prices and deadlines', () => {
    for (const model of MODELS) {
      const session = new DemoSession('stock');
      session.update({ model: model.id, budget: 12000, pickupDeadline: '17:30', date: '2026-12-12' });
      const snapshot = finish(session);
      expect(snapshot.result?.status, JSON.stringify(snapshot.result)).toBe('completed');
      expect(snapshot.result?.fields).toMatchObject({ serial: model.id.replace(/-/g, ''), price: model.price, date: '2026-12-12', time: '17:30' });
      expect(snapshot.transcript.some(t => t.source === 'callee' && t.text.includes('購入義務はありません'))).toBe(true);
    }
  });

  it('search choices bind a different fictional target to the approval', () => {
    const session = new DemoSession('restaurant');
    expect(session.update({ venueId: VENUES[1]!.id, date: '2026-12-24', time: '20:30', partySize: 4, budget: 12000 })).toBe(true);
    const snapshot = finish(session);
    expect(snapshot.approval?.target.number).toBe('SIM-002');
    expect(snapshot.approval?.input).toMatchObject({ partySize: 4, budget: 12000 });
    expect(snapshot.result?.status, JSON.stringify(snapshot.result)).toBe('completed');
    expect(snapshot.result?.fields).toMatchObject({ date: '2026-12-24', time: '20:30', partySize: 4, price: 11000 });
  });
});

describe('fail-closed outcomes', () => {
  const cases = kinds.flatMap(kind => SCENARIOS.filter(s => s.id !== 'normal').map(s => ({ kind, scenario: s.id })));
  it.each(cases)('$kind / $scenario never reports success', ({ kind, scenario }) => {
    const session = new DemoSession(kind);
    expect(session.setScenario(scenario)).toBe(true);
    const snapshot = finish(session);
    expect(snapshot.result?.status).not.toBe('completed');
    expect(snapshot.result?.fields.confirmed).not.toBe(true);
    if (kind === 'modify') {
      expect(snapshot.result?.originalPreserved).toBe(true);
      expect(snapshot.result?.detail).toContain('19時');
      expect(snapshot.reservation).toEqual(ORIGINAL_RESERVATION);
    }
    if (scenario === 'unavailable') {
      expect(snapshot.result?.status).toBe('failed');
      expect(snapshot.transcript.every(t => t.source === 'system')).toBe(true);
      expect(snapshot.result?.evidence).toEqual([]);
    }
    if (scenario === 'over-budget') {
      expect(snapshot.result?.status).toBe('constraint_violation');
      expect(snapshot.transcript.some(t => t.source === 'caller' && t.text.includes('申し込みません'))).toBe(true);
    }
    if (scenario === 'correction') {
      expect(snapshot.result?.evidence.some(e => e.field === 'confirmed' && e.verified)).toBe(true);
      expect(snapshot.result?.missing).toContain('confirmed');
    }
  });

  it('a low stock budget stops without accepting a higher quote even on the normal path', () => {
    const session = new DemoSession('stock');
    session.update({ budget: 2000 });
    const snapshot = finish(session);
    expect(snapshot.result?.status).toBe('constraint_violation');
    expect(snapshot.result?.fields.confirmed).not.toBe(true);
    expect(snapshot.transcript.some(t => t.source === 'caller' && t.text.includes('でお願いします'))).toBe(false);
  });

  it('does not claim success from approval or before the complete transcript has been evaluated', () => {
    const session = new DemoSession();
    session.review(); session.approve();
    while (session.snapshot().step < session.snapshot().totalSteps - 1) {
      expect(session.snapshot().result).toBeNull();
      expect(session.stage).toBe('calling');
      session.next();
    }
    expect(session.snapshot().result).toBeNull();
    session.next();
    expect(session.snapshot().result?.status).toBe('completed');
  });

  it('does not change the synthetic booking before final verification, even after an initial confirmation', () => {
    const session = new DemoSession('modify');
    session.review(); session.approve();
    while (session.snapshot().step < session.snapshot().totalSteps - 1) session.next();
    expect(session.snapshot().transcript.some(t => t.source === 'callee' && t.text.includes('ご予約を承りました'))).toBe(true);
    expect(session.snapshot().reservation).toEqual(ORIGINAL_RESERVATION);
    session.cancel();
    expect(session.snapshot().reservation).toEqual(ORIGINAL_RESERVATION);
    expect(session.snapshot().result?.status).toBe('cancelled');
  });
});

describe('authorization and lifecycle', () => {
  it('cannot start or advance without a review followed by explicit approval', () => {
    const session = new DemoSession();
    expect(session.approve()).toBe(false);
    expect(session.next()).toBe(false);
    expect(session.snapshot().transcript).toEqual([]);
    session.review();
    expect(session.next()).toBe(false);
    expect(session.snapshot().approval).toBeNull();
  });

  it('double approval and stale next actions cannot start or repeat a second call', () => {
    const session = new DemoSession();
    session.review();
    expect(session.approve()).toBe(true);
    const approval = session.snapshot().approval;
    expect(session.approve()).toBe(false);
    expect(session.next(0)).toBe(true);
    expect(session.next(0)).toBe(false);
    expect(session.snapshot().transcript).toHaveLength(1);
    expect(session.snapshot().approval).toEqual(approval);
  });

  it.each(['input', 'review', 'calling'] as const)('cancels at %s and rejects all stale continuation', stage => {
    const session = new DemoSession('modify');
    if (stage !== 'input') session.review();
    if (stage === 'calling') { session.approve(); session.next(0); }
    expect(session.cancel()).toBe(true);
    expect(session.cancel()).toBe(false);
    expect(session.approve()).toBe(false);
    expect(session.next()).toBe(false);
    expect(session.snapshot().approval).toBeNull();
    expect(session.snapshot().result).toMatchObject({ status: 'cancelled', originalPreserved: true });
  });

  it('back invalidates approval, clears the simulated run, and requires a fresh review', () => {
    const session = new DemoSession();
    session.review(); session.approve(); session.next(0);
    expect(session.back()).toBe(true);
    expect(session.stage).toBe('input');
    expect(session.snapshot().approval).toBeNull();
    expect(session.snapshot().transcript).toEqual([]);
    expect(session.next()).toBe(false);
    expect(session.approve()).toBe(false);
    session.update({ venueId: 'harbor' });
    expect(finish(session).approval?.target.number).toBe('SIM-002');
  });

  it('editing reviewed conditions or scenario returns to input and cannot reuse approval', () => {
    const session = new DemoSession();
    session.review();
    expect(session.update({ budget: 9000 })).toBe(true);
    expect(session.stage).toBe('input');
    expect(session.approve()).toBe(false);
    session.review();
    expect(session.setScenario('ambiguous')).toBe(true);
    expect(session.approve()).toBe(false);
    expect(finish(session).result?.status).toBe('incomplete');
  });

  it('conditions cannot be edited mid-call or after the result', () => {
    const session = new DemoSession();
    session.review(); session.approve();
    expect(session.update({ budget: 20000 })).toBe(false);
    expect(session.setScenario('normal')).toBe(false);
    while (session.stage === 'calling') session.next();
    expect(session.update({ budget: 20000 })).toBe(false);
    expect(session.snapshot().input.budget).toBe(8000);
  });

  it('returned snapshots and input objects cannot mutate the authoritative approval', () => {
    const session = new DemoSession();
    session.review(); session.approve();
    const snapshot = session.snapshot();
    snapshot.input.budget = 20000;
    snapshot.approval!.input.budget = 20000;
    snapshot.approval!.target.number = '+819012345678';
    snapshot.target.name = 'real target';
    session.input.budget = 20000;
    expect(session.input.budget).toBe(8000);
    expect(session.snapshot().approval?.target.number).toBe('SIM-001');
    expect(session.next(0)).toBe(true);
  });

  it('approval exposes only the synthetic name, plus a synthetic ID for modification', () => {
    for (const kind of kinds) {
      const session = new DemoSession(kind);
      session.review(); session.approve();
      const approval = session.snapshot().approval!;
      expect(approval.disclosure).toHaveLength(kind === 'modify' ? 2 : 1);
      expect(approval.disclosure[0]).toBe('架空氏名：デモ利用者');
      if (kind === 'modify') expect(approval.disclosure[1]).toContain(ORIGINAL_RESERVATION.id);
      expect(approval.allowedActions).toHaveLength(1);
      expect(approval.fingerprint).toContain(approval.target.number);
      expect(approval.fingerprint).toContain('maxCharge');
    }
  });
});

describe('bounded synthetic input', () => {
  it.each([
    { date: '2026-11-31' }, { date: '2026-11-99' }, { date: '2027-01-01' }, { date: 'today' },
    { time: '02:00' }, { time: '19:17' }, { partySize: 0 }, { partySize: 7 }, { partySize: NaN },
    { budget: -1 }, { budget: Infinity }, { budget: 20001 }, { model: 'REAL-1234' },
    { venueId: '+819012345678' }, { pickupDeadline: '23:00' },
  ])('rejects unsupported input %j without changing approved terms', patch => {
    const session = new DemoSession();
    expect(session.update(patch)).toBe(false);
    expect(session.input).toEqual(new DemoSession().input);
    expect(session.snapshot().error).toBeTruthy();
  });

  it('rejects real names, arbitrary fields and arbitrary target numbers', () => {
    const session = new DemoSession();
    expect(session.update({ name: 'Real Person' } as never)).toBe(false);
    expect(session.update({ phone: '+819012345678' } as never)).toBe(false);
    expect(session.setScenario('real-call' as DemoScenario)).toBe(false);
  });

  it('cannot review or approve stale valid input after a failed update', () => {
    const session = new DemoSession();
    expect(session.update({ budget: -1 })).toBe(false);
    expect(session.review()).toBe(false);
    expect(session.approve()).toBe(false);
    expect(session.update({ budget: 9000 })).toBe(true);
    expect(session.review()).toBe(true);
    expect(session.update({ date: '2026-13-00' })).toBe(false);
    expect(session.approve()).toBe(false);
    expect(session.snapshot().approval).toBeNull();
    expect(session.update({ date: '2026-12-31' })).toBe(true);
    expect(finish(session).result?.status).toBe('completed');
  });

  it('locks modification to the known synthetic booking and exact permitted change', () => {
    const session = new DemoSession('modify');
    for (const patch of [{ time: '21:00' }, { budget: 1000 }, { date: '2026-11-21' }, { partySize: 3 }, { venueId: 'harbor' }]) {
      expect(session.update(patch)).toBe(false);
    }
    expect(session.review()).toBe(false);
    expect(session.update({ time: '20:00', budget: 0, date: ORIGINAL_RESERVATION.date, partySize: 2, venueId: 'garden' })).toBe(true);
    const snapshot = finish(session);
    expect(snapshot.result?.fields.time).toBe('20:00');
    expect(snapshot.result?.originalPreserved).toBe(false);
    expect(snapshot.reservation).toEqual({ ...ORIGINAL_RESERVATION, time: '20:00' });
  });

  it('honors accepted boundary dates, deadlines, times, party sizes and budgets', () => {
    const dinner = new DemoSession('restaurant');
    dinner.update({ date: '2026-10-11', time: '21:30', partySize: 6, budget: 2000 });
    expect(finish(dinner).result?.status).toBe('completed');
    for (const deadline of ['10:00', '20:30']) {
      const stock = new DemoSession('stock');
      stock.update({ date: '2026-12-31', pickupDeadline: deadline, budget: 20000 });
      expect(finish(stock).result?.status).toBe('completed');
    }
  });
});
