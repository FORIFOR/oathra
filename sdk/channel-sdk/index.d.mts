export interface ChannelEvent {
  eventId: string;
  actor: string;
  destination: string;
  type: "message" | "action" | "unlink" | "unsend";
  text?: string;
  ackId?: string;
  action?: string;
  sourceMessageId?: string;
  media?: { id: string; duration: number };
}
export interface ChannelMessage {
  channel: string;
  actor: string;
  destination: string;
  text: string;
  buttons?: Array<{ label: string; data: string }>;
}
export interface ChannelContext {
  env: Readonly<Record<string, string | undefined>>;
  config: Readonly<Record<string, unknown>>;
  fetchImpl: typeof fetch;
  now(): number;
}
export interface ChannelAdapter {
  /** Synchronous v1 ingress. Must authenticate ORIGINAL bytes before decoding. */
  verify(raw: Uint8Array, headers: Record<string, string | string[] | undefined>): boolean;
  decode(raw: Uint8Array, headers: Record<string, string | string[] | undefined>): {
    events: ChannelEvent[]; response?: Record<string, unknown>;
  };
  send(message: ChannelMessage, context: { retryKey: string; signal: AbortSignal; fetchImpl: typeof fetch }): Promise<{ status: "accepted"; providerId?: string }>;
  transcribe?(media: NonNullable<ChannelEvent["media"]>): Promise<string>;
  acknowledge?(event: Readonly<ChannelEvent>): Promise<void>;
  ready?(): boolean;
  close?(): void | Promise<void>;
}
export declare function defineChannel<T extends ChannelAdapter>(implementation: T): Readonly<T>;
