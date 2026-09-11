import type { BrainContext, BrainProvider, BrainResponse } from "@oathra/core";
import { buildMessages, parseBrainJson, withUsage } from "@oathra/brain-kit";

export type GeminiBrainOptions = {
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  timeoutMs?: number;
};

/** Google Gemini generateContent. */
export class GeminiBrain implements BrainProvider {
  readonly name: string;
  private readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly temperature: number;
  private readonly timeoutMs: number;

  constructor(opts: GeminiBrainOptions = {}) {
    this.model = opts.model ?? "gemini-flash-latest";
    this.apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
    this.baseUrl = (opts.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
    this.temperature = opts.temperature ?? 0.4;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.name = `gemini:${this.model}`;
  }

  async respond(ctx: BrainContext, hooks?: { onToken?: (token: string) => void }): Promise<BrainResponse> {
    if (!this.apiKey) throw new Error("GEMINI_API_KEY is not set. Get one at https://aistudio.google.com/apikey");
    const messages = buildMessages(ctx);
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    const url = `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { temperature: this.temperature, responseMimeType: "application/json", maxOutputTokens: 300 },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const content = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    hooks?.onToken?.(content);
    const usage = { inputTokens: data.usageMetadata?.promptTokenCount ?? 0, outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0 };
    return withUsage(parseBrainJson(content), this.model, usage);
  }
}
