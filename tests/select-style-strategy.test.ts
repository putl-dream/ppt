import { describe, expect, it } from "vitest";
import { selectStyleStrategyTool } from "../src/main/agent/tools/deferred/select-style-strategy";

describe("SelectStyleStrategy", () => {
  it("supports English and Chinese audience/topic keywords with an explanation", async () => {
    const technical = await selectStyleStrategyTool.execute(
      {
        targetAudience: "external developers",
        coreMessage: "Explain the API architecture and engineering roadmap",
      },
      {} as never,
    );
    expect(technical.presetId).toBe("technical");
    expect(technical.matchedKeywords).toEqual(expect.arrayContaining(["architecture", "engineering", "developer", "api"]));

    const academic = await selectStyleStrategyTool.execute(
      {
        targetAudience: "高校教师与学生",
        coreMessage: "研究方法课程",
      },
      {} as never,
    );
    expect(academic.presetId).toBe("academic");
    expect(academic.reason).toContain("Matched explicit");
  });

  it("labels the business fallback as a default rather than a personalized inference", async () => {
    const result = await selectStyleStrategyTool.execute(
      { targetAudience: "general audience", coreMessage: "Unclassified topic" },
      {} as never,
    );
    expect(result.presetId).toBe("business");
    expect(result.matchedKeywords).toEqual([]);
    expect(result.reason).toContain("No specialized keywords matched");
  });
});
