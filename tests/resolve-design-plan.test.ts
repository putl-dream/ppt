import { describe, expect, it } from "vitest";
import { resolveDesignPlanTool } from "../src/main/agent/tools/deferred/resolve-design-plan";

const baseContract = {
  audience: "CTO",
  objective: "申请批准试点",
  desiredOutcome: "批准 90 天执行计划",
  coreMessage: "AI 开发工具能在治理边界内提高交付速度",
  deliveryContext: "20 分钟现场汇报",
  afterUse: "作为决策记录",
};

describe("ResolveDesignPlan", () => {
  it("returns a distinct safe/shifted/bold technology spectrum", async () => {
    const result = await resolveDesignPlanTool.execute({
      communicationContract: baseContract,
      sourceText: "AI developer architecture",
    }, {} as never);

    expect(result.selectionSource).toBe("recommended-spectrum");
    expect(result.directions.map((direction) => direction.tier)).toEqual([
      "safe",
      "shifted",
      "bold",
    ]);
    expect(result.directions.map((direction) => direction.designSystem.visualStyle)).toEqual([
      "swiss-minimal",
      "blueprint",
      "dark-tech",
    ]);
    expect(new Set(result.directions.map(
      (direction) => direction.designSystem.argumentMode,
    )).size).toBe(1);
  });

  it("locks an explicitly requested visual style without a fake choice", async () => {
    const result = await resolveDesignPlanTool.execute({
      communicationContract: baseContract,
      visualStyle: "ink-wash",
      argumentMode: "narrative",
      readingMode: "presentation",
    }, {} as never);

    expect(result.selectionSource).toBe("user-locked");
    expect(result.directions).toHaveLength(1);
    expect(result.directions[0]).toMatchObject({
      tier: "locked",
      designSystem: {
        version: 2,
        visualStyle: "ink-wash",
        argumentMode: "narrative",
        readingMode: "presentation",
      },
    });
  });
});
