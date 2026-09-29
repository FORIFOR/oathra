/**
 * A restaurant's reservation desk: the ledger and its rules, with no model in it.
 *
 * The voice that answers the phone may talk however it likes; whether a table exists, and whether it is now
 * taken, is decided here. A call holds at most one booking: asked again it is the same booking, changed it
 * moves, and the table it left goes back on sale. Nothing is promised twice.
 */
export type DeskConfig = {
  /** The restaurant's name, as said on the phone. */
  name: string;
  /** Tables per seating time, "HH:MM" -> count. Only these times can be booked. */
  slots: Record<string, number>;
  maxParty: number;
  /** ISO dates the restaurant is closed. */
  closedDates?: string[];
  /** Weekdays the restaurant is closed, 0 = Sunday. */
  closedWeekdays?: number[];
  /** How far ahead a table can be booked. Default 60 days. */
  bookAheadDays?: number;
};

export type DeskBooking = { id: string; date: string; time: string; partySize: number; name: string; callId: string; phone?: string; createdAt: number };
export type DeskRequest = { date: string; time: string; partySize: number };

export type DeskRefusal =
  | { status: "invalid"; reason: "date" | "time" | "partySize" | "name" }
  | { status: "past" }
  | { status: "too_far"; bookAheadDays: number }
  | { status: "closed" }
  | { status: "too_many"; maxParty: number }
  | { status: "full"; alternatives: string[] };
export type DeskAnswer = { status: "available"; date: string; time: string; partySize: number } | DeskRefusal;
export type DeskBooked = { status: "booked"; booking: DeskBooking; moved: boolean };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/, TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Today's date in Japan, where the restaurant is. */
export function tokyoDate(now: number): string {
  return new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
}

export function parseDeskConfig(input: unknown): DeskConfig {
  const c = input as Partial<DeskConfig> | null;
  if (!c || typeof c !== "object") throw new Error("desk_config_invalid");
  const name = typeof c.name === "string" ? c.name.trim().slice(0, 40) : "";
  const slots = c.slots && typeof c.slots === "object" ? Object.entries(c.slots) : [];
  if (!name || slots.length === 0 || slots.length > 48 || slots.some(([t, n]) => !TIME_RE.test(t) || !Number.isInteger(n) || n < 0 || n > 100)) throw new Error("desk_config_invalid");
  if (!Number.isInteger(c.maxParty) || (c.maxParty as number) < 1 || (c.maxParty as number) > 100) throw new Error("desk_config_invalid");
  if (c.closedDates !== undefined && (!Array.isArray(c.closedDates) || c.closedDates.some((d) => !DATE_RE.test(d)))) throw new Error("desk_config_invalid");
  if (c.closedWeekdays !== undefined && (!Array.isArray(c.closedWeekdays) || c.closedWeekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6))) throw new Error("desk_config_invalid");
  if (c.bookAheadDays !== undefined && (!Number.isInteger(c.bookAheadDays) || c.bookAheadDays < 1 || c.bookAheadDays > 365)) throw new Error("desk_config_invalid");
  return { name, slots: Object.fromEntries(slots), maxParty: c.maxParty as number, ...(c.closedDates ? { closedDates: c.closedDates } : {}), ...(c.closedWeekdays ? { closedWeekdays: c.closedWeekdays } : {}), ...(c.bookAheadDays ? { bookAheadDays: c.bookAheadDays } : {}) };
}

function tablesLeft(config: DeskConfig, bookings: readonly DeskBooking[], date: string, time: string, callId?: string): number {
  return (config.slots[time] ?? 0) - bookings.filter((b) => b.date === date && b.time === time && b.callId !== callId).length;
}

/** Is there a table? `callId` makes the call's own booking count as free to itself. */
export function checkTable(config: DeskConfig, bookings: readonly DeskBooking[], request: DeskRequest, now: number, callId?: string): DeskAnswer {
  const { date, time, partySize } = request;
  if (typeof date !== "string" || !DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return { status: "invalid", reason: "date" };
  if (typeof time !== "string" || !TIME_RE.test(time)) return { status: "invalid", reason: "time" };
  if (!Number.isInteger(partySize) || partySize < 1) return { status: "invalid", reason: "partySize" };
  const today = tokyoDate(now), ahead = config.bookAheadDays ?? 60;
  if (date < today || (date === today && time <= new Date(now + 9 * 3600_000).toISOString().slice(11, 16))) return { status: "past" };
  if ((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400_000 > ahead) return { status: "too_far", bookAheadDays: ahead };
  if (config.closedDates?.includes(date) || config.closedWeekdays?.includes(new Date(`${date}T00:00:00Z`).getUTCDay())) return { status: "closed" };
  if (partySize > config.maxParty) return { status: "too_many", maxParty: config.maxParty };
  if (tablesLeft(config, bookings, date, time, callId) > 0) return { status: "available", date, time, partySize };
  // Nearest seatings first, so the first thing offered is the closest to what was asked for.
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const alternatives = Object.keys(config.slots).filter((t) => t !== time && tablesLeft(config, bookings, date, t, callId) > 0 && (date > today || t > new Date(now + 9 * 3600_000).toISOString().slice(11, 16)))
    .sort((a, b) => Math.abs(minutes(a) - minutes(time)) - Math.abs(minutes(b) - minutes(time)) || a.localeCompare(b)).slice(0, 3);
  return { status: "full", alternatives };
}

/**
 * Write the booking down. Returns the new ledger; the caller persists it (atomically, with the check).
 * A call that already holds a booking moves it rather than taking a second table.
 */
export function bookTable(config: DeskConfig, bookings: readonly DeskBooking[], request: DeskRequest & { name: string; callId: string; phone?: string; id: string }, now: number): { answer: DeskBooked | DeskRefusal; bookings: DeskBooking[] } {
  const name = typeof request.name === "string" ? request.name.trim().slice(0, 40) : "";
  if (!name) return { answer: { status: "invalid", reason: "name" }, bookings: [...bookings] };
  const answer = checkTable(config, bookings, request, now, request.callId);
  if (answer.status !== "available") return { answer, bookings: [...bookings] };
  const previous = bookings.find((b) => b.callId === request.callId);
  const booking: DeskBooking = { id: previous?.id ?? request.id, date: request.date, time: request.time, partySize: request.partySize, name, callId: request.callId, ...(request.phone ? { phone: request.phone } : {}), createdAt: previous?.createdAt ?? now };
  return { answer: { status: "booked", booking, moved: !!previous }, bookings: [...bookings.filter((b) => b.callId !== request.callId), booking] };
}
