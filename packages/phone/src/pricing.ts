import type { RateEstimate } from "./types.js";

/** Rough destination classification from an E.164 number. */
export function classifyDestination(e164: string): { country: string; kind: "mobile" | "landline" | "unknown" } {
  if (/^\+81(70|80|90)/.test(e164)) return { country: "JP", kind: "mobile" };
  if (/^\+81/.test(e164)) return { country: "JP", kind: "landline" };
  if (/^\+1/.test(e164)) return { country: "US", kind: "unknown" };
  return { country: e164.slice(1, 3), kind: "unknown" };
}

/**
 * Published list prices (USD/min). Kept as a reference table so `phone doctor`
 * and `setup` can show a comparison; real invoices come from the carrier.
 * Sources: provider pricing pages, checked 2026-09.
 */
export const REFERENCE_RATES: Record<string, Record<string, number>> = {
  twilio: { "JP:mobile": 0.185, "JP:landline": 0.052, "US:unknown": 0.014 },
  plivo: { "JP:mobile": 0.1398, "JP:landline": 0.0385, "US:unknown": 0.01 },
};

export function referenceRate(provider: string, e164: string): RateEstimate | undefined {
  const d = classifyDestination(e164);
  const table = REFERENCE_RATES[provider];
  const key = `${d.country}:${d.kind}`;
  const rate = table?.[key] ?? table?.[`${d.country}:unknown`];
  if (rate === undefined) return undefined;
  return { destination: `${d.country} ${d.kind}`, provider, ratePerMin: rate, currency: "USD", note: "published list price; your account may differ" };
}
