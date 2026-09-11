/**
 * @oathra/gateway-livekit — SipGateway backed by LiveKit (Cloud or self-hosted).
 *
 * The gateway owns two things: outbound SIP trunks (created through the LiveKit
 * SIP API from a carrier's trunk spec) and call media (a LiveKit room with the
 * SIP participant on one side and Oathra's audio track on the other). Carriers
 * never see LiveKit; Oathra never sees SIP.
 */
import type { AccessToken as AccessTokenT, RoomServiceClient as RoomServiceClientT, SipClient as SipClientT } from "livekit-server-sdk";

type ServerSdk = { AccessToken: typeof AccessTokenT; RoomServiceClient: typeof RoomServiceClientT; SipClient: typeof SipClientT };
let sdkPromise: Promise<ServerSdk> | undefined;
/** Loaded on first use so the CLI bundle stays light; SIP users install the SDK explicitly. */
async function loadServerSdk(): Promise<ServerSdk> {
  sdkPromise ??= import("livekit-server-sdk").catch(() => {
    throw new Error("LiveKit SIP gateway needs `livekit-server-sdk` and `@livekit/rtc-node`: run  npm i livekit-server-sdk @livekit/rtc-node");
  }) as Promise<ServerSdk>;
  return sdkPromise;
}
import type { AudioSpec } from "@oathra/voice";
import { convert, OutputQueue, PCM_48K, type AudioChunk } from "@oathra/voice";
import { check, type CarrierEvent, type CarrierMediaSession, type DialOptions, type DoctorCheck, type SipGateway, type SipTrunkSpec } from "@oathra/phone";
import { realRtcRoomFactory, type RtcRoom, type RtcRoomFactory } from "./rtc.js";

export type { RtcRoom, RtcRoomFactory, RemoteFrame } from "./rtc.js";

/** The subset of livekit-server-sdk the gateway uses (mockable). */
export type LiveKitClients = {
  sip: Pick<SipClientT, "createSipOutboundTrunk" | "listSipOutboundTrunk" | "deleteSipTrunk" | "createSipParticipant">;
  rooms: Pick<RoomServiceClientT, "createRoom" | "deleteRoom" | "removeParticipant">;
  token: (room: string, identity: string) => Promise<string>;
};

export type LiveKitGatewayOptions = {
  url?: string;
  apiKey?: string;
  apiSecret?: string;
  clients?: LiveKitClients;
  rtc?: RtcRoomFactory;
  /** Identity of the SIP participant in the room. */
  calleeIdentity?: string;
};

const TRANSPORT_ENUM: Record<NonNullable<SipTrunkSpec["transport"]> | "auto", number> = { auto: 0, udp: 1, tcp: 2, tls: 3 };

function httpUrl(wsUrl: string): string {
  return wsUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

export class LiveKitSipGateway implements SipGateway {
  readonly id = "livekit";
  readonly label = "LiveKit SIP (Cloud or self-hosted)";
  readonly requires = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"];
  private readonly url: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly rtc: RtcRoomFactory;
  private readonly calleeIdentity: string;
  private clientsCache: LiveKitClients | undefined;

  constructor(private readonly opts: LiveKitGatewayOptions = {}) {
    this.url = opts.url ?? process.env.LIVEKIT_URL ?? "";
    this.apiKey = opts.apiKey ?? process.env.LIVEKIT_API_KEY ?? "";
    this.apiSecret = opts.apiSecret ?? process.env.LIVEKIT_API_SECRET ?? "";
    this.rtc = opts.rtc ?? realRtcRoomFactory;
    this.calleeIdentity = opts.calleeIdentity ?? "callee";
    if (opts.clients) this.clientsCache = opts.clients;
  }

  private async clients(): Promise<LiveKitClients> {
    if (this.clientsCache) return this.clientsCache;
    if (!this.url || !this.apiKey || !this.apiSecret) throw new Error("LiveKit gateway needs LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET");
    const { SipClient, RoomServiceClient, AccessToken } = await loadServerSdk();
    const http = httpUrl(this.url);
    const sip = new SipClient(http, this.apiKey, this.apiSecret);
    const rooms = new RoomServiceClient(http, this.apiKey, this.apiSecret);
    const token = async (room: string, identity: string) => {
      const t = new AccessToken(this.apiKey, this.apiSecret, { identity, ttl: "1h" });
      t.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true });
      return t.toJwt();
    };
    this.clientsCache = { sip, rooms, token };
    return this.clientsCache;
  }

  async ensureTrunk(spec: SipTrunkSpec): Promise<{ trunkId: string; created: boolean }> {
    const { sip } = await this.clients();
    const name = `oathra-${spec.provider}`;
    const existing = (await sip.listSipOutboundTrunk()).find(
      (t) => t.address === spec.address && (t.name === name || spec.numbers.some((n) => t.numbers.includes(n))),
    );
    if (existing) return { trunkId: existing.sipTrunkId, created: false };
    const created = await sip.createSipOutboundTrunk(name, spec.address, spec.numbers, {
      transport: TRANSPORT_ENUM[spec.transport ?? "auto"] as never,
      ...(spec.username ? { authUsername: spec.username } : {}),
      ...(spec.password ? { authPassword: spec.password } : {}),
      metadata: JSON.stringify({ oathra: true, provider: spec.provider }),
    });
    return { trunkId: created.sipTrunkId, created: true };
  }

  async listTrunks(): Promise<Array<{ trunkId: string; address: string; numbers: string[] }>> {
    const { sip } = await this.clients();
    return (await sip.listSipOutboundTrunk()).map((t) => ({ trunkId: t.sipTrunkId, address: t.address, numbers: [...t.numbers] }));
  }

  async removeTrunk(trunkId: string): Promise<void> {
    await (await this.clients()).sip.deleteSipTrunk(trunkId);
  }

  async dial(trunkId: string, opts: DialOptions): Promise<CarrierMediaSession> {
    const clients = await this.clients();
    const roomName = `oathra-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await clients.rooms.createRoom({ name: roomName, emptyTimeout: 120, maxParticipants: 3 });
    const room = this.rtc();
    const session = new LiveKitMediaSession(room, clients, roomName, this.calleeIdentity);
    try {
      await room.connect(this.url, await clients.token(roomName, "oathra"));
      await session.publish();
    } catch (e) {
      await clients.rooms.deleteRoom(roomName).catch(() => undefined);
      throw e;
    }
    // Dial in the background; `connected` fires when the callee's audio arrives.
    void clients.sip
      .createSipParticipant(trunkId, opts.to, roomName, {
        participantIdentity: this.calleeIdentity,
        participantName: opts.to,
        waitUntilAnswered: true,
        playDialtone: false,
        ...(opts.callerId ? { fromNumber: opts.callerId } : {}),
      })
      .then((info) => session.onDialed(info.sipCallId))
      .catch((err: Error) => session.fail(`SIP dial failed: ${err.message}`));
    return session;
  }

  async check(): Promise<DoctorCheck[]> {
    const out: DoctorCheck[] = [];
    if (!this.url) return [check("LiveKit configured", false, { fix: "Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in .env" })];
    out.push(check("LiveKit URL", true, { detail: this.url.replace(/^(wss?:\/\/)([^.]+)\./, "$1<project>.") }));
    try {
      const t0 = Date.now();
      const trunks = await (await this.clients()).sip.listSipOutboundTrunk();
      out.push(check("LiveKit authenticated", true, { detail: `${trunks.length} outbound trunk(s), ${Date.now() - t0} ms` }));
    } catch (e) {
      out.push(check("LiveKit authenticated", false, { detail: (e as Error).message, fix: "Check LIVEKIT_API_KEY / LIVEKIT_API_SECRET" }));
    }
    return out;
  }

  async loopback(_engineAudio: AudioSpec): Promise<DoctorCheck[]> {
    // A room-level loopback (publish a tone, subscribe from a second identity) needs
    // two rtc connections; not implemented in this build.
    return [{ label: "Gateway loopback", ok: true, skipped: true, detail: "not implemented for LiveKit yet; use `oathra phone test --level pstn`" }];
  }
}

/** One call's media: LiveKit room ↔ CarrierMediaSession (PCM 48 kHz mono). */
export class LiveKitMediaSession implements CarrierMediaSession {
  readonly audio = PCM_48K;
  readonly events: AsyncIterable<CarrierEvent>;
  private readonly queue = new OutputQueue<CarrierEvent>();
  private readonly startWall = Date.now();
  private sink: { capture(samples: Int16Array): Promise<void>; clear(): void } | undefined;
  private pending: Int16Array[] = [];
  private pumping = false;
  private sentSamples = 0;
  private sendStartMs: number | undefined;
  private ended = false;
  private connected = false;
  sipCallId: string | undefined;

  constructor(
    private readonly room: RtcRoom,
    private readonly clients: LiveKitClients,
    readonly roomName: string,
    private readonly calleeIdentity: string,
  ) {
    this.events = this.queue;
    room.onRemoteAudio((identity, frames) => {
      if (identity !== calleeIdentity) return;
      if (!this.connected) {
        this.connected = true;
        this.queue.push({ type: "connected", ...(this.sipCallId ? { callId: this.sipCallId } : {}) });
      }
      void this.pumpRemote(frames);
    });
    room.onParticipantDisconnected((identity) => {
      if (identity === calleeIdentity) void this.end("callee_hangup");
    });
    room.onDisconnected(() => void this.end("room_closed"));
  }

  now(): number {
    return Date.now() - this.startWall;
  }

  async publish(): Promise<void> {
    this.sink = await this.room.publishSource(PCM_48K.sampleRate);
  }

  onDialed(sipCallId: string): void {
    this.sipCallId = sipCallId;
  }

  fail(message: string): void {
    this.queue.push({ type: "error", message, fatal: true });
    void this.end("dial_failed");
  }

  private async pumpRemote(frames: AsyncIterable<{ data: Int16Array; sampleRate: number; channels: number }>): Promise<void> {
    try {
      for await (const f of frames) {
        if (this.ended) break;
        const chunk: AudioChunk = { format: "pcm_s16le", sampleRate: f.sampleRate, channels: f.channels, data: new Uint8Array(f.data.buffer, f.data.byteOffset, f.data.byteLength).slice() };
        this.queue.push({ type: "audio", chunk: f.channels === 1 && f.sampleRate === PCM_48K.sampleRate ? chunk : convert(chunk, PCM_48K) });
      }
    } catch (e) {
      if (!this.ended) this.queue.push({ type: "error", message: (e as Error).message });
    }
  }

  send(chunk: AudioChunk): void {
    if (this.ended || !this.sink) return;
    const pcm = convert(chunk, PCM_48K);
    this.pending.push(new Int16Array(pcm.data.buffer, pcm.data.byteOffset, Math.floor(pcm.data.byteLength / 2)));
    if (!this.pumping) void this.pump();
  }

  /** Capture 10 ms frames, staying at most 400 ms ahead of real time so `clear()` stays effective. */
  private async pump(): Promise<void> {
    this.pumping = true;
    const FRAME = PCM_48K.sampleRate / 100; // 480 samples = 10 ms
    let carry = new Int16Array(0);
    try {
      while (!this.ended && (this.pending.length || carry.length >= FRAME)) {
        if (carry.length < FRAME) {
          const next = this.pending.shift()!;
          const merged = new Int16Array(carry.length + next.length);
          merged.set(carry, 0);
          merged.set(next, carry.length);
          carry = merged;
          continue;
        }
        const frame = carry.slice(0, FRAME);
        carry = carry.subarray(FRAME);
        if (this.sendStartMs === undefined) this.sendStartMs = this.now();
        await this.sink!.capture(frame);
        this.sentSamples += FRAME;
        const aheadMs = (this.sentSamples / PCM_48K.sampleRate) * 1000 - (this.now() - this.sendStartMs);
        if (aheadMs > 400) await new Promise((r) => setTimeout(r, aheadMs - 300));
      }
      if (carry.length && !this.ended) {
        const last = new Int16Array(FRAME);
        last.set(carry, 0);
        await this.sink!.capture(last);
      }
    } finally {
      this.pumping = false;
    }
  }

  clear(): void {
    this.pending = [];
    this.sink?.clear();
    // Reset pacing so the next reply starts immediately.
    this.sentSamples = 0;
    this.sendStartMs = undefined;
  }

  async hangup(reason?: string): Promise<void> {
    await this.end(reason ?? "hangup");
  }

  private async end(reason: string): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    this.queue.push({ type: "hangup", reason });
    this.queue.close();
    await this.clients.rooms.removeParticipant(this.roomName, this.calleeIdentity).catch(() => undefined);
    await this.room.disconnect().catch(() => undefined);
    await this.clients.rooms.deleteRoom(this.roomName).catch(() => undefined);
  }
}
