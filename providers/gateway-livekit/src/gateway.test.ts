import { describe, expect, it } from "vitest";
import { OutputQueue, type AudioChunk } from "@oathra/voice";
import { LiveKitSipGateway, type LiveKitClients } from "./index.js";
import type { RemoteFrame, RtcRoom } from "./rtc.js";

type Trunk = { sipTrunkId: string; name: string; address: string; numbers: string[]; authUsername: string; transport: number };

function fakeClients(initial: Trunk[] = []) {
  const trunks = [...initial];
  const log: string[] = [];
  let dialResolve: ((v: { sipCallId: string }) => void) | undefined;
  let dialReject: ((e: Error) => void) | undefined;
  const clients = {
    sip: {
      async listSipOutboundTrunk() {
        log.push("list");
        return trunks as never;
      },
      async createSipOutboundTrunk(name: string, address: string, numbers: string[], opts?: { authUsername?: string; transport?: number }) {
        log.push(`create:${name}`);
        const t: Trunk = { sipTrunkId: `ST_${trunks.length + 1}`, name, address, numbers, authUsername: opts?.authUsername ?? "", transport: opts?.transport ?? 0 };
        trunks.push(t);
        return t as never;
      },
      async deleteSipTrunk(id: string) {
        log.push(`delete:${id}`);
        const i = trunks.findIndex((t) => t.sipTrunkId === id);
        if (i >= 0) trunks.splice(i, 1);
        return {} as never;
      },
      createSipParticipant(trunkId: string, number: string, room: string, opts?: { participantIdentity?: string; waitUntilAnswered?: boolean; fromNumber?: string }) {
        log.push(`dial:${trunkId}:${number}:${room}:${opts?.participantIdentity}:${opts?.waitUntilAnswered}:${opts?.fromNumber ?? ""}`);
        return new Promise<{ sipCallId: string }>((res, rej) => {
          dialResolve = res;
          dialReject = rej;
        }) as never;
      },
    },
    rooms: {
      async createRoom(o: { name: string }) {
        log.push(`room:${o.name}`);
        return { name: o.name } as never;
      },
      async deleteRoom(name: string) {
        log.push(`deleteRoom:${name}`);
      },
      async removeParticipant(room: string, identity: string) {
        log.push(`remove:${room}:${identity}`);
      },
    },
    token: async (room: string, identity: string) => `jwt:${room}:${identity}`,
  } satisfies LiveKitClients;
  return { clients, trunks, log, answer: (id = "SCL_1") => dialResolve?.({ sipCallId: id }), failDial: (m: string) => dialReject?.(new Error(m)) };
}

function fakeRoom() {
  const captured: Int16Array[] = [];
  const remote = new OutputQueue<RemoteFrame>();
  const cbs: { audio?: (identity: string, frames: AsyncIterable<RemoteFrame>) => void; left?: (id: string) => void; closed?: () => void } = {};
  let cleared = 0;
  const room: RtcRoom & { captured: Int16Array[]; remote: OutputQueue<RemoteFrame>; emitCallee(): void; leave(): void; cleared(): number; connectedTo: string[] } = {
    captured,
    remote,
    connectedTo: [],
    async connect(url, token) {
      room.connectedTo.push(`${url}|${token}`);
    },
    async publishSource() {
      return { capture: async (s: Int16Array) => void captured.push(s), clear: () => void cleared++ };
    },
    onRemoteAudio(cb) {
      cbs.audio = cb;
    },
    onParticipantDisconnected(cb) {
      cbs.left = cb;
    },
    onDisconnected(cb) {
      cbs.closed = cb;
    },
    async disconnect() {},
    emitCallee: () => cbs.audio?.("callee", remote),
    leave: () => cbs.left?.("callee"),
    cleared: () => cleared,
  };
  return room;
}

const gw = (clients: LiveKitClients, rtc?: () => RtcRoom) =>
  new LiveKitSipGateway({ url: "wss://x.livekit.cloud", apiKey: "k", apiSecret: "s", clients, ...(rtc ? { rtc } : {}) });

describe("LiveKitSipGateway trunks", () => {
  it("creates a trunk once and reuses it by address/number", async () => {
    const f = fakeClients();
    const g = gw(f.clients);
    const a = await g.ensureTrunk({ address: "TR1.zt.plivo.com", transport: "tcp", username: "u", password: "p", numbers: ["+815012345678"], provider: "plivo" });
    expect(a).toEqual({ trunkId: "ST_1", created: true });
    expect(f.trunks[0]).toMatchObject({ name: "oathra-plivo", authUsername: "u", transport: 2 });
    const b = await g.ensureTrunk({ address: "TR1.zt.plivo.com", numbers: ["+815012345678"], provider: "plivo" });
    expect(b).toEqual({ trunkId: "ST_1", created: false });
    expect(await g.listTrunks()).toEqual([{ trunkId: "ST_1", address: "TR1.zt.plivo.com", numbers: ["+815012345678"] }]);
    await g.removeTrunk("ST_1");
    expect(f.trunks).toHaveLength(0);
  });

  it("check() reports auth", async () => {
    const f = fakeClients();
    const checks = await gw(f.clients).check();
    expect(checks.every((c) => c.ok)).toBe(true);
    const unconfigured = new LiveKitSipGateway({ url: "", apiKey: "", apiSecret: "" });
    expect((await unconfigured.check())[0]?.ok).toBe(false);
  });
});

describe("LiveKitSipGateway media", () => {
  it("dials, connects on callee audio, converts frames both ways, paces sends, clears and hangs up", async () => {
    const f = fakeClients([{ sipTrunkId: "ST_1", name: "oathra-sip", address: "sip.example.com", numbers: ["+81312345678"], authUsername: "", transport: 0 }]);
    const room = fakeRoom();
    const g = gw(f.clients, () => room);
    const session = await g.dial("ST_1", { to: "+819012345678", callerId: "+81312345678", language: "ja", contract: {} as never });
    expect(room.connectedTo[0]).toMatch(/^wss:\/\/x\.livekit\.cloud\|jwt:oathra-[a-z0-9]+:oathra$/);
    expect(f.log.some((l) => l.startsWith("dial:ST_1:+819012345678:oathra-") && l.endsWith(":callee:true:+81312345678"))).toBe(true);
    f.answer("SCL_9");
    await new Promise((r) => setTimeout(r, 5));

    const events: string[] = [];
    const iter = session.events[Symbol.asyncIterator]();
    // callee audio: 20 ms of stereo 48k -> mono 48k chunk
    const stereo = new Int16Array(960 * 2).fill(1000);
    room.emitCallee();
    room.remote.push({ data: stereo, sampleRate: 48000, channels: 2 });
    const e1 = (await iter.next()).value;
    events.push(e1.type);
    const e2 = (await iter.next()).value;
    events.push(e2.type);
    expect(events).toEqual(["connected", "audio"]);
    expect(e1.type === "connected" && e1.callId).toBe("SCL_9");
    expect(e2.type === "audio" && e2.chunk.channels).toBe(1);
    expect(e2.type === "audio" && e2.chunk.data.byteLength).toBe(960 * 2);

    // send: 40 ms μ-law 8k -> 4 frames of 480 samples at 48k
    const mulaw: AudioChunk = { format: "mulaw", sampleRate: 8000, channels: 1, data: new Uint8Array(320).fill(0xff) };
    session.send(mulaw);
    await new Promise((r) => setTimeout(r, 20));
    expect(room.captured.length).toBe(4);
    expect(room.captured.every((c) => c.length === 480)).toBe(true);

    session.clear();
    expect(room.cleared()).toBe(1);

    await session.hangup("done");
    const e3 = (await iter.next()).value;
    expect(e3.type).toBe("hangup");
    expect(f.log).toContain("remove:" + session.roomName + ":callee");
    expect(f.log).toContain("deleteRoom:" + session.roomName);
  });

  it("surfaces a failed dial as a fatal error and ends the session", async () => {
    const f = fakeClients([{ sipTrunkId: "ST_1", name: "t", address: "a", numbers: [], authUsername: "", transport: 0 }]);
    const room = fakeRoom();
    const session = await gw(f.clients, () => room).dial("ST_1", { to: "+819000000000", language: "ja", contract: {} as never });
    f.failDial("no route");
    const iter = session.events[Symbol.asyncIterator]();
    const e = (await iter.next()).value;
    expect(e.type).toBe("error");
    expect(e.type === "error" && e.message).toContain("no route");
    expect((await iter.next()).value.type).toBe("hangup");
  });

  it("ends when the callee leaves the room", async () => {
    const f = fakeClients([{ sipTrunkId: "ST_1", name: "t", address: "a", numbers: [], authUsername: "", transport: 0 }]);
    const room = fakeRoom();
    const session = await gw(f.clients, () => room).dial("ST_1", { to: "+819000000000", language: "ja", contract: {} as never });
    room.leave();
    const e = (await session.events[Symbol.asyncIterator]().next()).value;
    expect(e.type).toBe("hangup");
    expect(e.type === "hangup" && e.reason).toBe("callee_hangup");
  });
});

const LIVE = process.env.OATHRA_LIVE_TESTS === "1" && Boolean(process.env.LIVEKIT_API_KEY);
describe("LiveKit live", () => {
  if (!LIVE) console.log("SKIPPED: LiveKit live trunk listing — credentials not configured (set OATHRA_LIVE_TESTS=1 and LIVEKIT_*)");
  it.skipIf(!LIVE)("lists outbound trunks with real credentials (read-only)", async () => {
    const checks = await new LiveKitSipGateway().check();
    expect(checks.every((c) => c.ok)).toBe(true);
  });
});
