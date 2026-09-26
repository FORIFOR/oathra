/**
 * Restaurant reception: the words, and the two tools that reach the reservation desk.
 *
 * The model never decides that a table exists or that it is booked. `check_table` and `book_table` ask the
 * desk (`@oathra/core`), and `book_table` is refused until the agent has said the date, the time, the party
 * size and the name aloud on this call: what gets written down is what the caller heard, as read by the
 * deterministic parsers, not what a model believes was agreed.
 */
import type { CallContract } from "@oathra/contract";
import type { DeskAnswer, DeskBooked, DeskRefusal, DeskRequest } from "@oathra/core";
import { parseDates, parsePartySize, parseTimes, type Language } from "@oathra/evidence";
import { conversationPolicies } from "./phone-message.js";

export type ReservationDesk = {
  check(request: DeskRequest): DeskAnswer | Promise<DeskAnswer>;
  book(request: DeskRequest & { name: string }): DeskBooked | DeskRefusal | Promise<DeskBooked | DeskRefusal>;
};

export type DeskToolResult = DeskAnswer | DeskBooked | { status: "read_back_required"; missing: string[] } | { status: "unavailable" };
export type DeskEvent = { type: "desk.check" | "desk.book"; request: Record<string, unknown>; result: DeskToolResult };

export const DESK_TOOLS = [
  {
    type: "function",
    name: "check_table",
    description: "Ask the reservation desk whether a table is free. The only way to know: never answer availability from memory. date is YYYY-MM-DD, time is HH:MM (24h), partySize is the number of guests.",
    parameters: { type: "object", properties: { date: { type: "string" }, time: { type: "string" }, partySize: { type: "integer" } }, required: ["date", "time", "partySize"], additionalProperties: false },
  },
  {
    type: "function",
    name: "book_table",
    description: "Write the booking into the ledger. Call it only after you have read the date, time, party size and name back to the caller aloud and they said yes. The booking exists only if this returns status=booked. Calling it again on the same call changes that booking; it never adds a second one.",
    parameters: { type: "object", properties: { date: { type: "string" }, time: { type: "string" }, partySize: { type: "integer" }, name: { type: "string" } }, required: ["date", "time", "partySize", "name"], additionalProperties: false },
  },
] as const;

/** Which of the booking's values the agent has not yet said aloud on this call. */
export function notReadBack(said: readonly string[], request: DeskRequest & { name: string }, now: Date, language: Language): string[] {
  const text = said.join("\n"), missing: string[] = [];
  if (!parseDates(text, now, language).some((d) => d.value === request.date)) missing.push("date");
  if (!parseTimes(text, language).some((t) => t.value === request.time)) missing.push("time");
  if (!parsePartySize(text, language).some((p) => p.value === request.partySize)) missing.push("partySize");
  const name = String(request.name ?? "").trim();
  if (!name || !text.normalize("NFKC").includes(name.normalize("NFKC"))) missing.push("name");
  return missing;
}

/** One desk tool call, start to finish. Never throws: a desk that fails is reported as unavailable, and nothing is booked. */
export async function deskTool(desk: ReservationDesk, tool: string, args: Record<string, unknown>, said: readonly string[], now: Date, language: Language): Promise<DeskToolResult> {
  const request = { date: String(args.date ?? ""), time: String(args.time ?? ""), partySize: Number(args.partySize) };
  try {
    if (tool === "check_table") return await desk.check(request);
    const booking = { ...request, name: String(args.name ?? "").trim() };
    const missing = notReadBack(said, booking, now, language);
    if (missing.length) return { status: "read_back_required", missing };
    return await desk.book(booking);
  } catch {
    return { status: "unavailable" };
  }
}

export function receptionGreeting(contract: CallContract): string {
  const name = String(contract.input.restaurantName ?? "");
  return contract.language === "ja" ? `お電話ありがとうございます。${name}です。AIが受付をしております。ご予約でしょうか？` : `Thank you for calling ${name}. This is the AI reception. Would you like to book a table?`;
}

export function restaurantReceptionInstructions(contract: CallContract): string {
  const i = contract.input, name = String(i.restaurantName ?? ""), seatings = Array.isArray(i.seatings) ? i.seatings.join("、") : "", closed = typeof i.closedNote === "string" ? i.closedNote : undefined;
  return [
    `あなたは飲食店「${name}」の電話受付をしているAIです。店にかかってきた電話に出ています。人間の店員を装わないでください。一人称は必ず「私」を使ってください。`,
    `最初に「お電話ありがとうございます。${name}です。AIが受付をしております」と、店名とAIであることを伝えてください。`,
    `今日は${String(i.today ?? "")}です（日本時間）。「あさって」「今週の金曜」などは、この日付から年月日に直してください。予約できる時刻は ${seatings} だけです。1組は${String(i.maxParty ?? "")}名までです。${closed ? `休業: ${closed}。` : ""}`,
    "受けるのは席の予約だけです。必要なのは、日付、時刻、人数、予約のお名前の4つです。足りないものを一度に一つずつ、短く丁寧に尋ねてください。相手がすでに言ったことは聞き直さないでください。",
    "空席は必ず check_table で確認してください。記憶や推測で「空いています」「満席です」と答えないでください。結果が full なら alternatives の時刻を近い順に提案し、closed・too_many・past・too_far ならその理由を伝えてください。相手の希望と違う時刻を勝手に決めないでください。",
    "4つが揃ったら、「9月25日の19時半、2名様、田中様でよろしいでしょうか」のように、月日・時刻・人数・お名前を必ず声に出して復唱し、相手の「はい」を待ってください。「はい」をもらってから book_table を呼んでください。",
    "book_table が status=booked を返して初めて「ご予約を承りました」と伝えてください。それ以外の結果では予約は成立していません: read_back_required なら missing の項目を復唱し直してもう一度確認する、full なら代わりの時刻を提案する、unavailable なら「ただいま予約を記録できません。恐れ入りますが、あらためてお電話ください」と伝える。成立していない予約を成立したと言わないでください。",
    "同じ電話の中で内容を変えたいと言われたら、新しい内容を復唱して「はい」をもらい、もう一度 book_table を呼んでください（前の予約は置き換わります）。",
    "料金、割引、貸切、コース内容、アレルギー対応、キャンセル料など、台帳にないことは約束しないでください。「私からはお答えできないので、店の者に申し伝えます」と答えてください。支払い情報やカード番号は聞かないでください。予約以外の用件（営業、取材など）は、お名前と用件だけ聞いて「申し伝えます」と答えてください。",
    "相手が「誰?」「AI?」と聞いたら、AIの受付であることを最優先で答えてください。",
    conversationPolicies("ja"),
    "予約が済んだ、相手が切りたいと言った、無言や自動音声が続く場合は、短く挨拶してend_callで終了してください。",
    `Maximum call duration: ${Math.round(contract.budget.maxDurationMs / 1000)} seconds.`,
  ].join("\n");
}
