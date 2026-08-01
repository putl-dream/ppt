import { describe, expect, it } from "vitest";
import { resolveDesignPlan } from "../src/shared/design-recommendation";
import {
  buildLayoutPhasePrompt,
  confirmDesignPlan,
} from "../src/shared/layout-preference";
import { agentRunRequestSchema } from "../src/shared/ipc";

const candidate = resolveDesignPlan({
  communicationContract: {
    audience: "CTO",
    objective: "申请批准 AI 开发工具试点",
    desiredOutcome: "批准 90 天试点",
    coreMessage: "治理边界内的 AI 工具能提升交付速度",
    deliveryContext: "20 分钟现场汇报",
    afterUse: "作为试点决策记录",
  },
  sourceText: "AI developer architecture",
});

describe("layout phase prompt", () => {
  it("keeps the confirmed direction prompt free of orchestration instructions", () => {
    const choice = confirmDesignPlan(candidate, "direction-shifted");
    const prompt = buildLayoutPhasePrompt(choice);

    expect(prompt).toContain("设计方向已确认");
    expect(prompt).toContain("visualStyle=blueprint");
    expect(prompt).toMatch(/design-spec|SubmitSvgDeck|PreviewSvgPage/);
    expect(prompt).not.toMatch(/Task|TaskList|Claim|LoadSkill|ExecuteLayoutPlan/);
  });

  it("validates agent run requests without layoutChoice short-circuit metadata", () => {
    const request = agentRunRequestSchema.parse({
      prompt: "设计方向已确认。",
      sessionId: "session-1",
    });

    expect(request.prompt).toBe("设计方向已确认。");
    expect(request.sessionId).toBe("session-1");
    expect(request).not.toHaveProperty("layoutChoice");
  });

  it("still confirms a design direction for prompt construction", () => {
    const choice = confirmDesignPlan(candidate, "direction-bold");
    expect(choice.selectedDirectionId).toBe("direction-bold");
    expect(choice.directions).toHaveLength(3);
  });
});
