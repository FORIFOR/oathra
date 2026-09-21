import { randomUUID } from 'node:crypto';
import { assert, text } from './security.mjs';
import { BALANCE_LIMIT, firstConnectionNanoUsd } from './credit-guard.mjs';
import { METERED, nanoUsd, meteredCost } from './billing.mjs';

const LIMIT = 1_000_000_000;
function units(value) { assert(Number.isSafeInteger(value) && value > 0 && value <= LIMIT, 'invalid_credit_amount'); return value; }

/** Integer credits, durable and independent of call-history retention. Mutations marked *Tx require the caller's transaction. */
export class Credits {
  constructor(store, config) {
    this.store = store; this.config = config;
    store.db.exec(`CREATE TABLE IF NOT EXISTS credit_wallets(owner TEXT PRIMARY KEY,available INTEGER NOT NULL CHECK(available>=0),held INTEGER NOT NULL CHECK(held>=0));
      CREATE TABLE IF NOT EXISTS credit_holds(mission TEXT PRIMARY KEY,owner TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),status TEXT NOT NULL CHECK(status IN ('held','captured','released')));
      CREATE TABLE IF NOT EXISTS credit_ledger(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,owner TEXT NOT NULL,kind TEXT NOT NULL,amount INTEGER NOT NULL,reference TEXT NOT NULL,detail TEXT NOT NULL,created INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS credit_grants ON credit_ledger(reference) WHERE kind='grant';
      CREATE TABLE IF NOT EXISTS credit_settlements(mission TEXT PRIMARY KEY,owner TEXT NOT NULL,consumed INTEGER NOT NULL,released INTEGER NOT NULL,detail TEXT NOT NULL);`);
  }
  get enabled() { return this.config.deployment === 'managed'; }
  quote(mode,phone,spendingAmount) {
    if(this.enabled&&mode==='live'&&this.config.billing?.policy===METERED){
      let tariff=this.config.billing;
      if(tariff.settlement&&phone){const carrierRate=tariff.carrier.find(r=>phone.startsWith(r.prefix));assert(carrierRate,'carrier_rate_not_configured',409);const {carrier,...rest}=tariff;tariff={...rest,carrierRate};}
      const maximum=units(Math.ceil(nanoUsd(this.config.maxCallUsd)/tariff.creditNanoUsd));
      if(spendingAmount!==undefined){
        assert(tariff.settlement==='usage-rate-v1'&&tariff.carrierRate,'invalid_spending_limit');
        assert(Number.isSafeInteger(spendingAmount)&&spendingAmount>=0,'invalid_credit_amount');
        return {mode:'credits',amount:Math.min(maximum,spendingAmount),unit:'credit',policy:METERED,creditUsd:tariff.creditNanoUsd/1e9,tariff:structuredClone(tariff),spendingLimit:BALANCE_LIMIT,minimumAmount:Math.max(1,Math.ceil(firstConnectionNanoUsd(tariff)/tariff.creditNanoUsd))};
      }
      return {mode:'credits',amount:maximum,unit:'credit',policy:METERED,creditUsd:tariff.creditNanoUsd/1e9,tariff:structuredClone(tariff)};
    }
    const amount = this.enabled && mode === 'live' ? units(this.config.creditsPerCall) : 0;
    return { mode:this.enabled?'credits':'self-hosted', amount, unit:'credit', policy:'call-attempt-v1' };
  }
  currentQuote(m) { return this.quote(m.mode,m.target?.phone,m.creditQuote?.spendingLimit===BALANCE_LIMIT?m.creditQuote.amount:undefined); }
  status(m) { const h=this.store.db.prepare('SELECT status FROM credit_holds WHERE mission=? AND owner=?').get(m.id,m.owner);return h?.status??'none'; }
  /** Actual recorded movement for this call, independent of the current tariff or quote. */
  usage(m) {
    const hold=this.store.db.prepare('SELECT amount,status FROM credit_holds WHERE mission=? AND owner=?').get(m.id,m.owner);
    const settled=this.store.db.prepare('SELECT * FROM credit_settlements WHERE mission=? AND owner=?').get(m.id,m.owner);
    if(settled){const detail=this.store.open(settled.detail);return {status:detail.waived?'waived':'settled',consumed:settled.consumed,held:0,released:settled.released,...(!detail.waived?{cost:detail}:{})};}
    if(hold?.status==='held'&&m.creditQuote?.policy===METERED)return {status:m.executionId?'pending':'held',consumed:0,held:hold.amount,released:0};
    return {status:hold?.status??'none',consumed:hold?.status==='captured'?hold.amount:0,held:hold?.status==='held'?hold.amount:0,released:hold?.status==='released'?hold.amount:0};
  }
  balance(owner) { const w=this.store.db.prepare('SELECT available,held FROM credit_wallets WHERE owner=?').get(owner);return w??{available:0,held:0}; }
  pendingMissions(){return this.store.db.prepare("SELECT r.body FROM records r JOIN credit_holds h ON h.mission=r.id WHERE r.kind='mission' AND h.status='held' ORDER BY r.updated").all().map(r=>this.store.open(r.body));}
  history(owner, after = 0) {
    assert(Number.isSafeInteger(after)&&after>=0,'invalid_credit_cursor');
    return this.store.db.prepare('SELECT seq,id,kind,amount,reference,created,detail FROM credit_ledger WHERE owner=? AND seq>? ORDER BY seq LIMIT 100').all(owner,after)
      .map(({detail,...entry})=>({...entry,...this.store.open(detail)}));
  }
  entry(owner,kind,amount,reference,detail={}) { this.store.db.prepare('INSERT INTO credit_ledger(id,owner,kind,amount,reference,detail,created) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),owner,kind,amount,reference,this.store.seal(detail),this.store.now()); }
  grant(actor,owner,amount,reference,reason) {
    assert(this.enabled,'credits_not_enabled',409); assert(actor.role==='admin','administrator_required',403);
    units(amount);reference=text(reference,150);reason=text(reason,500);
    assert(this.config.users.some(u=>u.id===owner),'not_found',404);
    return this.store.tx(()=>{
      const previous=this.store.db.prepare("SELECT owner,amount,detail FROM credit_ledger WHERE kind='grant' AND reference=?").get(reference);
      if(previous) { assert(previous.owner===owner&&previous.amount===amount&&this.store.open(previous.detail).reason===reason,'idempotency_conflict',409); return {balance:this.balance(owner),replayed:true}; }
      const w=this.balance(owner);assert(w.available+w.held+amount<=LIMIT,'credit_balance_limit',409);
      this.store.db.prepare('INSERT INTO credit_wallets VALUES(?,?,0) ON CONFLICT(owner) DO UPDATE SET available=available+excluded.available').run(owner,amount);
      this.entry(owner,'grant',amount,reference,{actor:actor.id,reason});this.store.audit(actor.id,'credits.granted',reference,{owner,amount});
      return {balance:this.balance(owner),replayed:false};
    });
  }
  reserveTx(m) {
    const q=m.creditQuote ?? (this.enabled ? null : this.quote(m.mode));
    assert(JSON.stringify(q)===JSON.stringify(this.currentQuote(m)),'credit_price_changed_review_again',409);
    if(q.spendingLimit===BALANCE_LIMIT)assert(q.amount>=q.minimumAmount,'insufficient_connection_credits',402);
    if(!q.amount)return;
    assert(!this.store.db.prepare('SELECT mission FROM credit_holds WHERE mission=?').get(m.id),'credit_reservation_exists',409);
    const changed=this.store.db.prepare('UPDATE credit_wallets SET available=available-?,held=held+? WHERE owner=? AND available>=?').run(q.amount,q.amount,m.owner,q.amount);
    assert(changed.changes===1,'insufficient_credits',402);
    this.store.db.prepare("INSERT INTO credit_holds VALUES(?,?,?,'held')").run(m.id,m.owner,q.amount);this.entry(m.owner,'reserve',q.amount,m.id);
  }
  captureTx(m) {
    const hold=this.store.db.prepare('SELECT * FROM credit_holds WHERE mission=?').get(m.id);
    if(!m.creditQuote?.amount){assert(!hold,'credit_reservation_mismatch',409);return;}
    if(hold?.owner===m.owner&&hold.amount===m.creditQuote.amount&&hold.status==='captured')return;
    assert(hold?.owner===m.owner&&hold.amount===m.creditQuote.amount&&hold.status==='held','credit_reservation_missing',409);
    if(m.creditQuote.policy===METERED)return; // Execution is not evidence of a charge.
    const moved=this.store.db.prepare('UPDATE credit_wallets SET held=held-? WHERE owner=? AND held>=?').run(hold.amount,m.owner,hold.amount);
    assert(moved.changes===1,'credit_reservation_mismatch',409);
    this.store.db.prepare("UPDATE credit_holds SET status='captured' WHERE mission=?").run(m.id);this.entry(m.owner,'consume',hold.amount,m.id);
  }
  releaseTx(m) {
    const hold=this.store.db.prepare('SELECT * FROM credit_holds WHERE mission=?').get(m.id);if(!hold||hold.status!=='held')return;
    assert(hold.owner===m.owner,'credit_reservation_mismatch',409);
    this.store.db.prepare('UPDATE credit_wallets SET available=available+?,held=held-? WHERE owner=?').run(hold.amount,hold.amount,m.owner);
    this.store.db.prepare("UPDATE credit_holds SET status='released' WHERE mission=?").run(m.id);this.entry(m.owner,'release',hold.amount,m.id);
  }
  settleTx(m) {
    if(m.creditQuote?.policy!==METERED)return false;
    if(this.store.db.prepare('SELECT mission FROM credit_settlements WHERE mission=?').get(m.id))return true;
    const cost=meteredCost(m);if(!cost)return false;
    const hold=this.store.db.prepare('SELECT * FROM credit_holds WHERE mission=?').get(m.id);
    assert(hold?.owner===m.owner&&hold.status==='held'&&hold.amount===m.creditQuote.amount,'credit_reservation_missing',409);
    const rate=m.creditQuote.tariff.creditNanoUsd;
    const calculated=Number((BigInt(cost.totalNanoUsd)+BigInt(rate)-1n)/BigInt(rate));
    const consumed=Math.min(hold.amount,calculated),released=hold.amount-consumed;
    const detail={...cost,creditUsd:rate/1e9,calculatedCredits:calculated,capped:calculated>consumed};
    const changed=this.store.db.prepare('UPDATE credit_wallets SET held=held-?,available=available+? WHERE owner=? AND held>=?').run(hold.amount,released,m.owner,hold.amount);
    assert(changed.changes===1,'credit_reservation_mismatch',409);
    this.store.db.prepare("UPDATE credit_holds SET status=? WHERE mission=?").run(consumed?'captured':'released',m.id);
    this.store.db.prepare('INSERT INTO credit_settlements VALUES(?,?,?,?,?)').run(m.id,m.owner,consumed,released,this.store.seal(detail));
    if(consumed)this.entry(m.owner,'consume',consumed,m.id,{policy:METERED});
    if(released)this.entry(m.owner,'release',released,m.id,{policy:METERED});
    m.billing.state='settled';m.billing.cost=detail;this.store.put('mission',m);
    this.store.audit(m.owner,'credits.settled',m.id,{consumed,released,policy:METERED});return true;
  }
  /**
   * Last resort for a call whose outcome can never be read back: the dial request
   * timed out or the worker died before a carrier SID was stored, so neither
   * reconciliation nor a waiver can ever apply and the hold would stay forever.
   * An administrator who has checked the carrier console returns the whole hold.
   */
  forceRelease(actor,missionId,reason,carrierChecked) {
    assert(actor.role==='admin','administrator_required',403);reason=text(reason,500);
    assert(carrierChecked===true,'carrier_console_check_required',403);
    return this.store.tx(()=>{
      const current=this.store.get('mission',missionId);assert(current,'not_found',404);
      const previous=this.store.db.prepare('SELECT * FROM credit_settlements WHERE mission=?').get(current.id);
      if(previous){assert(this.store.open(previous.detail).forced===true,'credits_already_settled',409);return this.usage(current);}
      // With a SID the carrier can still be asked; this path is only for the call that cannot be.
      assert(!current.carrierSid&&(current.status==='UNKNOWN'||current.stopNeedsReconciliation),'reconcile_call_instead',409);
      const hold=this.store.db.prepare('SELECT * FROM credit_holds WHERE mission=?').get(current.id);assert(hold?.status==='held'&&hold.owner===current.owner,'credit_reservation_missing',409);
      this.releaseTx(current);
      this.store.db.prepare('INSERT INTO credit_settlements VALUES(?,?,0,?,?)').run(current.id,current.owner,hold.amount,this.store.seal({waived:true,forced:true,reason,actor:actor.id}));
      if(current.billing)current.billing.state='waived';
      current.previousStatus=current.status;current.status='FAILED';current.error='carrier_outcome_unknown_released_by_operator';delete current.stopNeedsReconciliation;current.finishedAt??=this.store.now();
      this.store.put('mission',current);this.store.audit(actor.id,'credits.force_released',current.id,{owner:current.owner,released:hold.amount,reason});
      return this.usage(current);
    });
  }
  waive(actor,m,reason) {
    assert(actor.role==='admin','administrator_required',403);reason=text(reason,500);
    return this.store.tx(()=>{
      const current=this.store.get('mission',m.id);assert(current?.owner===m.owner,'not_found',404);
      const previous=this.store.db.prepare('SELECT * FROM credit_settlements WHERE mission=?').get(m.id);
      if(previous){assert(this.store.open(previous.detail).waived===true,'credits_already_settled',409);return this.usage(current);}
      assert(current.creditQuote?.policy===METERED&&current.billing?.executionFinished&&current.status!=='UNKNOWN'&&!current.stopNeedsReconciliation,'reconcile_call_before_waiving',409);
      assert(current.billing.carrier||current.error==='carrier_dial_rejected','reconcile_call_before_waiving',409);
      const hold=this.store.db.prepare('SELECT * FROM credit_holds WHERE mission=?').get(m.id);assert(hold?.status==='held'&&hold.owner===m.owner,'credit_reservation_missing',409);
      this.releaseTx(current);
      this.store.db.prepare('INSERT INTO credit_settlements VALUES(?,?,0,?,?)').run(m.id,m.owner,hold.amount,this.store.seal({waived:true,reason,actor:actor.id}));
      current.billing.state='waived';this.store.put('mission',current);this.store.audit(actor.id,'credits.waived',m.id,{owner:m.owner,released:hold.amount});return this.usage(current);
    });
  }
}
