import { describe, expect, it } from "vitest";
import { buildLayoutPhasePrompt } from "../src/shared/layout-preference";
import { agentRunRequestSchema } from "../src/shared/ipc";

describe("layout phase prompt", () => {
  it.each(["template", "creative"] as const)(
    "keeps %s layout prompt free of orchestration instructions",
    (mode) => {
      const prompt = buildLayoutPhasePrompt(mode, "ocean", "cyan");

      expect(prompt).toContain("排版方式已确认");
      expect(prompt).toContain("主题 ocean");
      expect(prompt).toContain("调色板 cyan");
      expect(prompt).not.toMatch(/Task|TaskGraph|Claim|submitted|LoadSkill|ExecuteLayoutPlan/);
    },
  );

  it("validates layout choice as structured run metadata", () => {
    const request = agentRunRequestSchema.parse({
      prompt: "排版方式已确认：标准模式。",
      sessionId: "session-1",
      layoutChoice: { mode: "template", theme: "nordic", palette: "cyan" },
    });

    expect(request.layoutChoice).toEqual({
      mode: "template",
      theme: "nordic",
      palette: "cyan",
    });
  });
});
