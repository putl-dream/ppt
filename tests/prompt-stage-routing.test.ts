import { describe, expect, it } from "vitest";
import { resolvePromptStage } from "../src/main/agent/runtime/prompt-stage";
import type { Presentation } from "../src/shared/presentation";
import type { WorkspaceArtifacts } from "../src/main/agent/runtime/workspace-artifacts";

const emptyArtifacts: WorkspaceArtifacts = {
  brief: false,
  outline: false,
  storyboard: false,
  layoutPlan: false,
};

function deck(slideCount: number, theme?: string): Presentation {
  return {
    id: "p",
    title: "t",
    revision: 1,
    theme: theme ?? "",
    palette: "cyan",
    slides: Array.from({ length: slideCount }, (_, i) => ({
      id: `slide-${i}`,
      title: `s${i}`,
      elements: [],
    })),
  } as Presentation;
}

describe("resolvePromptStage", () => {
  it("routes an explicit full-deck request to planning even with stray slides", () => {
    const stage = resolvePromptStage({
      request: "帮我把这份资料整理成一套完整季度汇报",
      presentation: deck(3),
      artifacts: emptyArtifacts,
    });
    expect(stage).toBe("planning");
  });

  it("routes '做成幻灯片' phrasing to planning from scratch", () => {
    const stage = resolvePromptStage({
      request: "把内容做成一份幻灯片",
      presentation: deck(0),
      artifacts: emptyArtifacts,
    });
    expect(stage).toBe("planning");
  });

  it("does not bounce genuine content work once a storyboard exists", () => {
    const stage = resolvePromptStage({
      request: "创建一套完整演示",
      presentation: deck(3),
      artifacts: { ...emptyArtifacts, storyboard: true },
    });
    expect(stage).toBe("content");
  });

  it("keeps light-edit for a small change on a themed deck", () => {
    const stage = resolvePromptStage({
      request: "改第 3 页标题",
      presentation: deck(5, "ocean"),
      artifacts: emptyArtifacts,
    });
    expect(stage).toBe("light-edit");
  });

  it("stays in content for a plain request on an unthemed deck", () => {
    const stage = resolvePromptStage({
      request: "补充一点说明",
      presentation: deck(3),
      artifacts: emptyArtifacts,
    });
    expect(stage).toBe("content");
  });
});
