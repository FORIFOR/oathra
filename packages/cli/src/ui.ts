/** Tiny terminal helpers. No dependencies, respects NO_COLOR. */
const ESC = "\u001b[";
const enabled = !process.env.NO_COLOR && Boolean(process.stdout.isTTY);
const wrap = (code: number) => (s: string) => (enabled ? `${ESC}${code}m${s}${ESC}0m` : s);
export const dim = wrap(2);
export const bold = wrap(1);
export const green = wrap(32);
export const red = wrap(31);
export const yellow = wrap(33);
export const cyan = wrap(36);

export const ok = (s: string) => `${green("✓")} ${s}`;
export const bad = (s: string) => `${red("✗")} ${s}`;
export const warn = (s: string) => `${yellow("!")} ${s}`;

export function box(lines: string[], width?: number): string {
  const w = width ?? Math.max(...lines.map((l) => visibleLength(l))) + 2;
  const top = `╭${"─".repeat(w)}╮`;
  const bottom = `╰${"─".repeat(w)}╯`;
  const body = lines.map((l) => `│ ${l}${" ".repeat(Math.max(0, w - 1 - visibleLength(l)))}│`);
  return [top, ...body, bottom].join("\n");
}

/** Approximate display width: CJK counts double, ANSI codes count zero. */
export function visibleLength(s: string): number {
  const stripped = s.replace(/\u001b\[[0-9;]*m/g, "");
  let n = 0;
  for (const ch of stripped) n += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1;
  return n;
}

export function mmss(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function table(rows: string[][], align: Array<"l" | "r"> = []): string {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => visibleLength(r[i] ?? ""))));
  return rows
    .map((r) =>
      r
        .map((c, i) => {
          const pad = " ".repeat(widths[i]! - visibleLength(c));
          return align[i] === "r" ? pad + c : c + pad;
        })
        .join("  "),
    )
    .join("\n");
}
