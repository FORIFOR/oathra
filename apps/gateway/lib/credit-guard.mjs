import { USAGE_RATE, usageRateCost } from './billing.mjs';

export const BALANCE_LIMIT = 'balance-v1';
export function firstConnectionNanoUsd(tariff) {
  const rate = tariff.carrierRate;
  return Number((BigInt(rate.perMinuteNanoUsd) * BigInt(rate.incrementSeconds) + 59n) / 60n) + tariff.mediaPerMinuteNanoUsd;
}
/** Use the same unit accounting as settlement; this view is never a ledger debit. */
export function spendingProgress(m, now) {
  if (m.creditQuote?.spendingLimit !== BALANCE_LIMIT || m.creditQuote?.tariff?.settlement !== USAGE_RATE || m.billing?.executionFinished || m.billing?.timing || ['completed','failed','busy','no-answer','canceled'].includes(m.carrierStatus)) return null;
  const started = m.billing?.answeredAt ?? m.billing?.connectedAt;
  if (!Number.isSafeInteger(started)) return null;
  const mediaStart = m.billing.connectedAt ?? started;
  const snapshot = structuredClone(m);
  snapshot.status = 'ACTIVE';
  delete snapshot.stopNeedsReconciliation;
  snapshot.billing.executionFinished = true;
  delete snapshot.billing.carrier;
  snapshot.billing.timing = { startedAt: mediaStart, endedAt: Math.max(now, mediaStart) };
  const current = usageRateCost(snapshot);
  // Stop before the next carrier minute if it cannot be funded. The final bill uses actual time.
  snapshot.billing.timing.endedAt += 1000;
  const next = usageRateCost(snapshot);
  if (!current || !next) return null;
  const budget = m.creditQuote.amount * m.creditQuote.tariff.creditNanoUsd;
  return { consumed: Math.ceil(current.totalNanoUsd / m.creditQuote.tariff.creditNanoUsd), limit: m.creditQuote.amount,
    totalNanoUsd: current.totalNanoUsd, stop: current.totalNanoUsd >= budget || next.totalNanoUsd > budget };
}
