import { voice, llm } from "@livekit/agents";
import { EvidenceEngine, evaluate, type CallContract, type ConnectionState } from "oathra/evidence";

/** Attach to an existing outbound AgentSession: assistant=caller, user=callee.
 * Use one binding per call. This example has been type-checked, not PSTN-tested.
 */
export function attachEvidence(session: voice.AgentSession, contract: CallContract, referenceDate: Date) {
  const engine = new EvidenceEngine({ language: contract.language, now: referenceDate });
  const started = performance.now();
  const seen = new Set<string>();
  let partialSpeech = false;
  const handler = (event: voice.ConversationItemAddedEvent) => {
    const item = event.item;
    if (!(item instanceof llm.ChatMessage) || (item.role !== "user" && item.role !== "assistant")) return;
    // Interrupted agent text may include words the callee never heard. Once
    // observed, require review instead of certifying this call as completed.
    if (item.interrupted) { partialSpeech = true; return; }
    if (!item.textContent?.trim() || seen.has(item.id)) return;
    seen.add(item.id);
    engine.ingest({
      id: item.id,
      source: item.role === "assistant" ? "caller" : "callee",
      text: item.textContent,
      t: performance.now() - started,
    });
  };
  session.on(voice.AgentSessionEventTypes.ConversationItemAdded, handler);
  return {
    engine,
    // Pass the actual carrier/call state. Session.close alone is not success.
    result(connection: ConnectionState) {
      const reviewRequired = partialSpeech;
      return { reviewRequired, result: evaluate(contract, engine, reviewRequired && connection === "completed" ? "active" : connection) };
    },
    detach() { session.off(voice.AgentSessionEventTypes.ConversationItemAdded, handler); },
  };
}
