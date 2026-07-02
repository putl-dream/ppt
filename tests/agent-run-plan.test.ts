import { describe, expect, it } from "vitest";
import {
  buildAgentRunPlan,
  hasMeaningfulArtifactContent,
  inferAgentIntent,
  inferAgentStage,
  isDefaultArtifactContent,
} from "../src/shared/agent-run-plan";
import {
  createDefaultBriefMarkdown,
  createDefaultOutlineMarkdown,
  serializeBriefMarkdown,
  parseBriefFields,
} from "../src/shared/project-artifacts";

describe("agent-run-plan", () => {
  const emptyProject = {
    brief: createDefaultBriefMarkdown(),
    outline: createDefaultOutlineMarkdown(),
    research: "",
    design: "",
    slides: "",
    deck: "",
  };

  it("treats default template artifacts as non-meaningful", () => {
    expect(isDefaultArtifactContent("brief", createDefaultBriefMarkdown())).toBe(true);
    expect(hasMeaningfulArtifactContent("brief", createDefaultBriefMarkdown())).toBe(false);
    expect(hasMeaningfulArtifactContent("brief", "")).toBe(false);
  });

  it("detects customized brief content", () => {
    const customBrief = serializeBriefMarkdown({
      ...parseBriefFields(createDefaultBriefMarkdown()),
      title: "Q3 投资人汇报",
    });
    expect(isDefaultArtifactContent("brief", customBrief)).toBe(false);
    expect(hasMeaningfulArtifactContent("brief", customBrief)).toBe(true);
  });

  it("infers brief stage for a fresh project without prompt hints", () => {
    expect(inferAgentStage({
      prompt: "帮我做一个关于 AI 趋势的汇报",
      artifactContents: emptyProject,
    })).toBe("brief");
  });

  it("infers generate-artifact intent for default brief content", () => {
    expect(inferAgentIntent("brief", emptyProject)).toBe("generate-artifact");
    expect(inferAgentIntent("outline", {
      ...emptyProject,
      brief: serializeBriefMarkdown({
        ...parseBriefFields(createDefaultBriefMarkdown()),
        title: "定制 Brief",
      }),
    })).toBe("generate-artifact");
  });

  it("infers revise-artifact when target stage has meaningful content", () => {
    const customBrief = serializeBriefMarkdown({
      ...parseBriefFields(createDefaultBriefMarkdown()),
      title: "定制 Brief",
    });
    expect(inferAgentIntent("brief", { ...emptyProject, brief: customBrief })).toBe("revise-artifact");
  });

  it("respects explicit stage hints in the prompt", () => {
    expect(inferAgentStage({
      prompt: "请根据现有资料更新大纲结构",
      artifactContents: emptyProject,
    })).toBe("outline");

    expect(inferAgentStage({
      prompt: "直接生成 PPT 幻灯片",
      artifactContents: emptyProject,
    })).toBe("deck");
  });

  it("builds a complete run plan with references", () => {
    const plan = buildAgentRunPlan({
      prompt: "整理研究资料",
      artifactContents: {
        ...emptyProject,
        brief: serializeBriefMarkdown({
          ...parseBriefFields(createDefaultBriefMarkdown()),
          title: "定制 Brief",
        }),
        outline: createDefaultOutlineMarkdown(),
      },
    });

    expect(plan.stage).toBe("research");
    expect(plan.intent).toBe("generate-artifact");
    expect(plan.targetArtifactId).toBe("research");
    expect(plan.referencedArtifactIds).toEqual(["brief", "outline"]);
  });

  it("infers deck revision when presentation already has slides", () => {
    const plan = buildAgentRunPlan({
      prompt: "优化第二页排版",
      artifactContents: emptyProject,
      presentation: {
        title: "Demo",
        revision: 2,
        slides: [{ id: "slide-1", title: "封面", elements: [] }],
      } as any,
    });

    expect(plan.stage).toBe("deck");
    expect(plan.intent).toBe("revise-deck");
  });
});
