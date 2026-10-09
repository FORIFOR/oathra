import { describe, expect, it } from "vitest";
import { CONCERN_TOOL, concernEvent, concernInstruction } from "./index.js";

describe("the model's own report of a worrying line", () => {
  it("passes on a known level and a bounded line, and nothing else", () => {
    expect(concernEvent({ level: "emergency", heard: " 胸がいとうて " })).toEqual({ type: "safety.reported", level: "emergency", heard: "胸がいとうて" });
    expect(concernEvent({ level: "machine", heard: "留守番電話" })?.level).toBe("machine");
    expect(concernEvent({ level: "diagnosis", heard: "x" })).toBeUndefined();
    expect(concernEvent({ level: "concern", heard: "  " })).toBeUndefined();
    expect(concernEvent({ level: "concern", heard: "あ".repeat(500) })!.heard).toHaveLength(300);
  });
  it("tells the model to report in any wording, silently, and that reporting is not summoning help", () => {
    const ja = concernInstruction("ja");
    for (const part of ["方言や遠回しな言い方でも", "迷ったら記録する", "相手に言わず", "あなたが助けを呼んだことにはなりません", "level を machine"]) expect(ja).toContain(part);
    expect(CONCERN_TOOL.parameters.properties.level.enum).toEqual(["emergency", "concern", "machine"]);
    expect(concernInstruction("en")).toContain("does not mean help was summoned");
  });
});
