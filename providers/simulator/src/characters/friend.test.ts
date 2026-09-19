import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { recordingNotice } from "@oathra/core";
import { runCall } from "@oathra/runtime";
import { contractFromScenario, loadScenarioFile } from "@oathra/scenario";
import { ScriptedAgent } from "../agent.js";
import { HumanCharacter } from "../character.js";
import { mulberry32 } from "../rng.js";
import { SimulatorTransport } from "../transport.js";
import { FriendCharacter } from "./friend.js";

const scenario = loadScenarioFile(resolve(import.meta.dirname, "../../../../scenarios/friend/friend-hype.yaml"));
const contract = contractFromScenario(scenario);
const NOW = new Date("2026-09-19T12:00:00+09:00");

describe("friend-hype: a hyped call with a friend", () => {
  it("is an appointment-style contract: the friend's own commitment confirms it", () => {
    expect(contract).toMatchObject({ goal: "friend.hangout", confirmation: "callee_acceptance", require: { date: true, time: true, confirmed: true } });
  });

  it.each([1, 2, 3, 7, 42])("seed %i: excitement settles nothing, the schedule check moves the time, 「絶対行く」 confirms it", async (seed) => {
    const transport = new SimulatorTransport({ scenario, pace: "fast", seed });
    const verifiedAfter: Array<{ text: string; fields: string[] }> = [];
    let verified: string[] = [];
    const out = await runCall({
      contract, transport, brain: new ScriptedAgent(), now: NOW, scenarioId: scenario.id, openingTimeoutMs: 50, openingNotice: recordingNotice("ja"),
      onEvent: (e) => {
        if (e.type === "evidence.verified") verified = [...new Set([...verified, e.evidence.field])];
        if (e.type === "mission.progress") verified = e.verified;
        if (e.type === "transcript.final" && e.source === "callee") verifiedAfter.push({ text: e.text, fields: verified });
      },
    });
    const dialogue = out.transcript.map((t) => `${t.source}: ${t.text}`).join("\n");

    expect(out.result.status, dialogue).toBe("completed");
    expect(out.result.fields).toEqual({ date: "2026-10-03", time: "20:30", confirmed: true });
    expect(await transport.lastCharacter?.truth?.()).toEqual({ date: "2026-10-03", time: "20:30", confirmed: true });
    expect(out.transcript.find((t) => t.source === "caller")!.text.startsWith("この通話は録音されています。")).toBe(true);
    expect(out.endReason).toBe("agent_hangup");

    // The hyped first reaction carries a hedge: nothing may be confirmed when it is heard.
    const hype = out.events.findIndex((e) => e.type === "transcript.final" && e.source === "callee" && /たぶん行ける/.test(e.text));
    expect(hype, dialogue).toBeGreaterThan(-1);
    const confirmedAt = out.events.findIndex((e) => e.type === "evidence.verified" && e.evidence.field === "confirmed");
    const committedAt = out.events.findIndex((e) => e.type === "transcript.final" && e.source === "callee" && /絶対行く/.test(e.text));
    expect(confirmedAt).toBeGreaterThan(hype);
    expect(confirmedAt).toBeGreaterThanOrEqual(committedAt - 3); // verified on the committing utterance, not before
    expect(out.events.slice(0, committedAt).some((e) => e.type === "evidence.verified" && e.evidence.field === "confirmed")).toBe(false);
  });

  it("a friend who only ever says 「行きたい！たぶん！」 never becomes a plan", async () => {
    const human = new HumanCharacter("ミカ", "もしもしー！");
    for (const line of ["えー！行きたい行きたい！たぶん行ける！", "うーん、たぶん大丈夫！", "行けたら行く！"]) human.reply(line);
    human.hangup("ごめん、また連絡するね！");
    const out = await runCall({ contract, transport: new SimulatorTransport({ scenario, pace: "fast", character: human }), brain: new ScriptedAgent(), now: NOW, openingTimeoutMs: 50 });
    expect(out.result.complete).toBe(false);
    expect(out.result.fields.confirmed).toBeUndefined();
  });

  it("the character is deterministic per seed and only commits to a time after the shift", () => {
    const talk = (seed: number) => {
      const c = new FriendCharacter(scenario, mulberry32(seed));
      const say = (lastAgentText: string) => (c.respond({ transcript: [], lastAgentText, language: "ja", turnIndex: 0, rng: mulberry32(seed) }) as { text: string }).text;
      return [say("焼肉行こ！10月3日の19時、どう！？"), say("10月3日の19時、いける？"), say("19時でお願い！"), c.truth(), say("じゃあ10月3日の20時半ね！"), c.truth()];
    };
    expect(talk(5)).toEqual(talk(5));
    const [, second, third, before, , after] = talk(5);
    expect(second).toContain("20時半からならいける");
    expect(third).toContain("20時半からならいける"); // insisting on 19:00 changes nothing
    expect(before).toEqual({ confirmed: false });
    expect(after).toEqual({ date: "2026-10-03", time: "20:30", confirmed: true });
  });
});
