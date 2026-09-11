import type { BrainContext, BrainProvider, BrainResponse } from "@oathra/core";
import { buildMessages, parseBrainJson, withUsage } from "@oathra/brain-kit";

export type OllamaBrainOptions = {
  model?: string;
  baseUrl?: string;
  temperature?: number;
  timeoutMs?: number;
};

/** Local models via Ollama's /api/chat. No API key, zero cost. */
export class OllamaBrain implements BrainProvider {
  readonly name: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly temperature: number;
  private readonly timeoutMs: number;

  constructor(opts: OllamaBrainOptions = {}) {
    this.model = opts.model ?? "qwen2.5:7b";
    this.baseUrl = (opts.baseUrl ?? process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/$/, "");
    this.temperature = opts.temperature ?? 0.4;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.name = `ollama:${this.model}`;
  }

  async respond(ctx: BrainContext, hooks?: { onToken?: (token: string) => void }): Promise<BrainResponse> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages: buildMessages(ctx),
          format: "json",
          stream: false,
          options: { temperature: this.temperature, num_predict: 300 },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new Error(`Ollama unreachable at ${this.baseUrl} (${(e as Error).message}). Start it with \`ollama serve\` and pull the model with \`ollama pull ${this.model}\`.`);
    }
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };
    const content = data.message?.content ?? "";
    hooks?.onToken?.(content);
    const usage = { inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0 };
    return withUsage(parseBrainJson(content), this.model, usage);
  }
}
