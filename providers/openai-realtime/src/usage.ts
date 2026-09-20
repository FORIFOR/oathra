/** Provider usage only; never includes conversation content or credentials. */
export type RealtimeUsageEvent = {kind: "started" | "pending" | "response" | "closed"; model: string; id?: string; usage?: Record<string, unknown>; complete?: boolean};
export class RealtimeUsage {
  private pending = new Set<string>();
  private invalid = false;
  constructor(private model: string, private report?: (event: RealtimeUsageEvent) => void) {}
  get enabled(): boolean { return !!this.report; }
  get waiting(): boolean { return this.pending.size > 0; }
  start(): void { this.report?.({kind:"started",model:this.model}); }
  message(msg: Record<string, unknown>): void {
    if (!this.report) return;
    const r = msg.response as Record<string, unknown> | undefined;
    if (msg.type === "response.created") {
      if (typeof r?.id !== "string") { this.invalid=true;return; }
      this.pending.add(r.id);this.report({kind:"pending",model:this.model,id:r.id});
    }
    if (msg.type === "response.done") {
      if (typeof r?.id !== "string") { this.invalid=true;return; }
      const raw=r.usage as Record<string, unknown> | undefined;
      const pick=(v:unknown,names:string[])=>{const o=v as Record<string,unknown>|undefined;return Object.fromEntries(names.filter(k=>typeof o?.[k]==="number").map(k=>[k,o![k]]));};
      const input=raw?.input_token_details as Record<string,unknown>|undefined;
      const usage={...pick(raw,["input_tokens","output_tokens"]),input_token_details:{...pick(input,["text_tokens","audio_tokens","image_tokens","cached_tokens"]),cached_tokens_details:pick(input?.cached_tokens_details,["text_tokens","audio_tokens","image_tokens"])},output_token_details:pick(raw?.output_token_details,["text_tokens","audio_tokens"])};
      this.report({kind:"response",model:this.model,id:r.id,usage});this.pending.delete(r.id);
    }
  }
  close(clean:boolean): void {if(!clean)this.invalid=true;this.report?.({kind:"closed",model:this.model,complete:clean&&!this.invalid&&!this.waiting});}
}
