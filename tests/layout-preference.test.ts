import { describe, expect, it } from "vitest";
import { buildLayoutPhasePrompt } from "../src/shared/layout-preference";
import { agentRunRequestSchema } from "../src/shared/ipc";
import { TEST_DESIGN_SYSTEM } from "./design-engine-test-utils";

describe("layout phase prompt", () => {
  it.each(["template", "creative"] as const)(
    "keeps %s layout prompt free of orchestration instructions",
    (mode) => {
      const prompt = buildLayoutPhasePrompt(mode, TEST_DESIGN_SYSTEM);

      expect(prompt).toContain("排版方式已确认");
      expect(prompt).toContain("设计系统");
      expect(prompt).toContain("business-blue");
      expect(prompt).not.toMatch(/Task|TaskGraph|Claim|submitted|LoadSkill|ExecuteLayoutPlan/);
    },
  );

  it("validates layout choice as structured run metadata", () => {
    const request = agentRunRequestSchema.parse({
      prompt: "排版方式已确认：标准模式。",
      sessionId: "session-1",
      layoutChoice: { mode: "template", designSystem: TEST_DESIGN_SYSTEM },
    });

    expect(request.layoutChoice).toEqual({
      mode: "template",
      designSystem: TEST_DESIGN_SYSTEM,
    });
  });
});
