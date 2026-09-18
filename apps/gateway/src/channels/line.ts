import type { ChannelCommand } from "../contracts.js";

export type LineEvent = {
  type: "message" | "postback";
  source: { userId: string };
  message?: { type: "text"; text: string };
  postback?: { data: string };
};

export function toLineCommand(event: LineEvent): ChannelCommand | null {
  if (event.type === "message" && event.message?.type === "text") {
    return { channel: "line", actorId: event.source.userId, kind: "draft", text: event.message.text };
  }

  if (event.type === "postback" && event.postback) {
    const p = new URLSearchParams(event.postback.data);
    const action = p.get("action");
    const missionId = p.get("mission");
    const revision = Number(p.get("revision"));
    const signedActionId = p.get("signed");
    if (!missionId || !Number.isInteger(revision) || !signedActionId) return null;
    if (action === "approve") {
      return { channel: "line", actorId: event.source.userId, kind: "approve", missionId, missionRevision: revision, signedActionId };
    }
    if (action === "cancel") {
      return { channel: "line", actorId: event.source.userId, kind: "cancel", missionId, missionRevision: revision, signedActionId };
    }
  }
  return null;
}

/**
 * Signature verification MUST happen on the raw webhook body before parsing
 * this event. A postback is only an intent signal; the gateway must still
 * validate actor identity, mission revision, signed action, expiry, policy
 * and suppression before issuing an approval token.
 */
