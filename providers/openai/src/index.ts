import type { BrainContext, BrainProvider, BrainResponse } from "@oathra/core";
import { buildMessages, parseBrainJson, withUsage } from "@oathra/brain-kit";

export type OpenAIBrainOptions = {
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  /** Request timeout in ms (phone turns must stay short). */
  timeoutMs?: number;
};

/** OpenAI Chat Completions (also works with any OpenAI-compatible baseUrl). */
export class OpenAIBrain implements BrainProvider {
  readonly name: string;
  private readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly temperature: number;
  private readonly timeoutMs: number;

  constructor(opts: OpenAIBrainOptions = {}) {
    this.model = opts.model ?? "gpt-4o-mini";
    this.apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
    this.baseUrl = (opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.temperature = opts.temperature ?? 0.4;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.name = `openai:${this.model}`;
  }

  async respond(ctx: BrainContext, hooks?: { onToken?: (token: string) => void }): Promise<BrainResponse> {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY is not set. Get one at https://platform.openai.com/api-keys");
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: buildMessages(ctx),
        temperature: this.temperature,
        response_format: { type: "json_object" },
        max_tokens: 300,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    hooks?.onToken?.(content);
    const usage = { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 };
    return withUsage(parseBrainJson(content), this.model, usage);
  }
}

export { OpenAITTS, type OpenAITTSOptions } from "./tts.js";
