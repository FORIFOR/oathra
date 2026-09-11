/** PCM audio frame. Providers agree on 16-bit little-endian mono. */
export type AudioFrame = {
  /** Sample rate in Hz (8000 for PSTN, 16000/24000/48000 for WebRTC). */
  sampleRate: number;
  /** Interleaved int16 samples (mono unless `channels` > 1). */
  samples: Int16Array;
  channels: number;
  /** Call-relative timestamp of the first sample, in ms. */
  t: number;
};

export function frameDurationMs(f: AudioFrame): number {
  return (f.samples.length / f.channels / f.sampleRate) * 1000;
}
