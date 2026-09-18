export interface CapabilityContext {
  env: Readonly<Record<string, string | undefined>>;
  config: Readonly<Record<string, unknown>>;
  fetchImpl: typeof fetch;
  now(): number;
}
export interface FollowupAction {
  id: string; owner: string; missionId: string; kind: string;
  details: Readonly<Record<string, unknown> & { recipient: string }>;
}
export interface CapabilityAdapter {
  /** Pure, synchronous preparation. Never perform an external write here. */
  preview(input: Record<string, unknown>, context: {
    mission: Readonly<Record<string, any>>; contact: Readonly<Record<string, any>>; now: number;
  }): Record<string, unknown>;
  /** Called only AFTER the host has persisted a separately approved EXECUTING action. */
  execute(action: Readonly<FollowupAction>, context: {
    bearer: string | null; fetchImpl: typeof fetch; signal: AbortSignal;
  }): Promise<{ id?: string; sid?: string }>;
  ready?(): boolean;
  close?(): void | Promise<void>;
}
export declare function defineCapability<T extends CapabilityAdapter>(implementation: T): Readonly<T>;

export interface CallCapability {
  execute(mission: Readonly<Record<string, any>>, hooks: {
    signal: AbortSignal;
    onEvent(event: Record<string, unknown>): void;
    control: { handoff?: () => Promise<unknown> };
  }): Promise<{ transcript?: ReadonlyArray<Record<string, unknown>>; result?: unknown }>;
}
export declare function defineCallCapability<T extends CallCapability>(implementation: T): Readonly<T>;
