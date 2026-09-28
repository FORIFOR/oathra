import type { BrainContext } from "@oathra/core";
import { callInstructions } from "./call-instructions.js";

// Shared by every host that speaks a phone request through a text brain and TTS (the CLI and Arena, the gateway).

/**
 * The acting direction for the prototype, the first sentence of the approved reference style (the rest of that
 * style was written for one line and would give every reply the same emotional arc).
 */
export const CHARACTER_TTS_STYLE = "日本語のアニメの会話シーンとして演じる。";

/**
 * How the text brain replies on a phone-request call spoken by TTS: the same call instructions the
 * speech-to-speech engines get (AI disclosure, on whose behalf, chat rules, the preset's speaking style), plus
 * what changes when replies are written and read aloud. The verdict still comes from the runtime's evidence.
 */
export function phoneRequestSystemPrompt(ctx: BrainContext): string {
  const ja = ctx.language === "ja";
  return [
    callInstructions({ contract: ctx.contract, view: ctx.mission }),
    "",
    ja ? "## この通話での返し方" : "## How you reply on this call",
    ...(ja ? [
      "- あなたの返答は文字で書かれ、そのまま声で読み上げられます。1回の返答は短く（1〜2文）。記号・絵文字・括弧書き・ト書きは書かないでください。",
      "- end_call や検索などの道具は使えません。上の指示で end_call を使う場面では、別れの挨拶を text に書き、action を \"hangup\" にしてください。",
      "- 通話が完了したかどうかはあなたではなく、相手の発言から判定されます。",
    ] : [
      "- Your reply is written and then read aloud. Keep each reply short (one or two sentences). No symbols, emoji, brackets or stage directions.",
      "- You have no tools such as end_call or search. Where the instructions above say to use end_call, write the goodbye in text and set action to \"hangup\".",
      "- Whether the call is complete is decided from what the callee says, not by you.",
    ]),
    ...(ctx.hints?.length ? ["", "## Runtime hints", ...ctx.hints.map((h) => `- ${h}`)] : []),
    "",
    'Respond ONLY with a JSON object, no prose, no code fences: {"text": string, "action": "continue" | "hangup"}',
  ].join("\n");
}
