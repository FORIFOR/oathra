/**
 * Thin seam over @livekit/rtc-node so the gateway logic is testable without
 * native bindings. The real implementation loads the SDK lazily.
 */
export type RemoteFrame = { data: Int16Array; sampleRate: number; channels: number };

export interface RtcRoom {
  connect(url: string, token: string): Promise<void>;
  /** Publish a mono 48 kHz microphone track; returns a frame sink. */
  publishSource(sampleRate: number): Promise<{ capture(samples: Int16Array): Promise<void>; clear(): void }>;
  /** Called once per remote audio track with an async frame stream. */
  onRemoteAudio(cb: (identity: string, frames: AsyncIterable<RemoteFrame>) => void): void;
  onParticipantDisconnected(cb: (identity: string) => void): void;
  onDisconnected(cb: () => void): void;
  disconnect(): Promise<void>;
}

export type RtcRoomFactory = () => RtcRoom;

/** Real rooms backed by @livekit/rtc-node (loaded on first use). */
export const realRtcRoomFactory: RtcRoomFactory = () => {
  let sdk: typeof import("@livekit/rtc-node") | undefined;
  let room: import("@livekit/rtc-node").Room | undefined;
  const remoteAudioCbs: Array<(identity: string, frames: AsyncIterable<RemoteFrame>) => void> = [];
  const disconnectedCbs: Array<(identity: string) => void> = [];
  const roomClosedCbs: Array<() => void> = [];
  return {
    async connect(url, token) {
      sdk = await import("@livekit/rtc-node");
      room = new sdk.Room();
      const { RoomEvent, TrackKind, AudioStream } = sdk;
      room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        if (track.kind !== TrackKind.KIND_AUDIO) return;
        const stream = new AudioStream(track, { sampleRate: 48000, numChannels: 1 });
        const frames: AsyncIterable<RemoteFrame> = {
          async *[Symbol.asyncIterator]() {
            for await (const f of stream) yield { data: f.data, sampleRate: f.sampleRate, channels: f.channels };
          },
        };
        for (const cb of remoteAudioCbs) cb(participant.identity, frames);
      });
      room.on(RoomEvent.ParticipantDisconnected, (p) => {
        for (const cb of disconnectedCbs) cb(p.identity);
      });
      room.on(RoomEvent.Disconnected, () => {
        for (const cb of roomClosedCbs) cb();
      });
      await room.connect(url, token, { autoSubscribe: true, dynacast: false });
    },
    async publishSource(sampleRate) {
      if (!sdk || !room?.localParticipant) throw new Error("rtc: not connected");
      const { AudioSource, LocalAudioTrack, TrackSource, AudioFrame } = sdk;
      const source = new AudioSource(sampleRate, 1);
      const track = LocalAudioTrack.createAudioTrack("oathra", source);
      await room.localParticipant.publishTrack(track, { source: TrackSource.SOURCE_MICROPHONE } as never);
      return {
        capture: (samples) => source.captureFrame(new AudioFrame(samples, sampleRate, 1, samples.length)),
        clear: () => source.clearQueue(),
      };
    },
    onRemoteAudio(cb) {
      remoteAudioCbs.push(cb);
    },
    onParticipantDisconnected(cb) {
      disconnectedCbs.push(cb);
    },
    onDisconnected(cb) {
      roomClosedCbs.push(cb);
    },
    async disconnect() {
      await room?.disconnect();
    },
  };
};
