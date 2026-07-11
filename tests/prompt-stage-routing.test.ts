import { describe, expect, it } from "vitest";
import {
  LEGACY_PROMPT_STAGE_MAP,
  normalizePromptStage,
  resolvePromptStage,
} from "../src/main/agent/runtime/prompt-stage";
import type { Presentation } from "../src/shared/presentation";
import type { WorkspaceArtifacts } from "../src/main/agent/runtime/workspace-artifacts";
import { TEST_DESIGN_SYSTEM } from "./design-engine-test-utils";

const emptyArtifacts: WorkspaceArtifacts = {
  brief: false,
  outline: false,
  storyboard: false,
  layoutPlan: false,
};

function deck(slideCount: number, styled?: string): Presentation {
  return {
    id: "p",
    title: "t",
    revision: 1,
    designSystem: TEST_DESIGN_SYSTEM,
    slides: Array.from({ length: slideCount }, (_, i) => ({
      id: `slide-${i}`,
      title: `s${i}`,
      ...(styled ? { layout: "concept" } : {}),
      elements: [],
    })),
  };
}

describe("normalizePromptStage", () => {
  it("maps all legacy 9-stage names to merged stages", () => {
    expect(normalizePromptStage("routing")).toBe("discover");
    expect(normalizePromptStage("planning")).toBe("discover");
    expect(normalizePromptStage("content")).toBe("author");
    expect(normalizePromptStage("layout-choice")).toBe("author");
    expect(normalizePromptStage("layout-design")).toBe("design");
    expect(normalizePromptStage("layout-exec")).toBe("style");
    expect(normalizePromptStage("review")).toBe("style");
    expect(normalizePromptStage("light-edit")).toBe("edit");
    expect(normalizePromptStage("export")).toBe("export");
  });

  it("passes through merged stage names unchanged", () => {
    expect(normalizePromptStage("discover")).toBe("discover");
    expect(normalizePromptStage("style")).toBe("style");
  });

  it("covers every legacy key", () => {
    expect(Object.keys(LEGACY_PROMPT_STAGE_MAP).length).toBe(8);
  });
});

describe("resolvePromptStage (6-stage machine)", () => {
  it("routes an explicit full-deck request to discover even with stray slides", () => {
    const stage = resolvePromptStage({
      request: "帮我把这份资料整理成一套完整季度汇报",
      presentation: deck(3),
      artifacts: emptyArtifacts,
    });
    expect(stage).toBe("discover");
  });

  it("routes '做成幻灯片' phrasing to discover from scratch", () => {
    const stage = resolvePromptStage({
      request: "把内容做成一份幻灯片",
      presentation: deck(0),
      artifacts: emptyArtifacts,
    });
    expect(stage).toBe("discover");
  });

  it("does not treat export capability descriptions as export actions", () => {
    const stage = resolvePromptStage({
      request: "全面展示 PPT Agent 从规划到导出的六阶段能力，约 15-18 页",
      presentation: deck(0),
      artifacts: emptyArtifacts,
    });
    expect(stage).toBe("discover");
  });

  it("routes explicit export commands to export", () => {
    const stage = resolvePromptStage({
      request: "请导出 PPT 文件",
      presentation: deck(8, "ocean"),
      artifacts: emptyArtifacts,
    });
    expect(stage).toBe("export");
  });

  it("does not bounce genuine author work once a storyboard exists", () => {
    const stage = resolvePromptStage({
      request: "创建一套完整演示",
      presentation: deck(3),
      artifacts: { ...emptyArtifacts, storyboard: true },
    });
    expect(stage).toBe("author");
  });

  it("does not restart planning once an outline exists", () => {
    const stage = resolvePromptStage({
      request: "创建一套完整演示",
      presentation: deck(0),
      artifacts: { ...emptyArtifacts, outline: true },
    });
    expect(stage).toBe("author");
  });

  it("keeps edit for a small change on a themed deck", () => {
    const stage = resolvePromptStage({
      request: "改第 3 页标题",
      presentation: deck(5, "ocean"),
      artifacts: emptyArtifacts,
    });
    expect(stage).toBe("edit");
  });

  it("routes slide image swap on a themed deck to edit", () => {
    const stage = resolvePromptStage({
      request: "帮我把第三页的图换一下",
      presentation: deck(5, "ocean"),
      artifacts: emptyArtifacts,
    });
    expect(stage).toBe("edit");
  });

  it("routes replace text on a specific slide to edit", () => {
    const stage = resolvePromptStage({
      request: "把第2页的文字调整一下",
      presentation: deck(4, "minimal"),
      artifacts: emptyArtifacts,
    });
    expect(stage).toBe("edit");
  });

  it("stays in author for a plain request on an unthemed deck", () => {
    const stage = resolvePromptStage({
      request: "补充一点说明",
      presentation: deck(3),
      artifacts: emptyArtifacts,
    });
    expect(stage).toBe("author");
  });

  it("resolves design from layout phase without layout-plan", () => {
    const stage = resolvePromptStage({
      request: "请对当前演示文稿执行标准排版（第二阶段）。",
      presentation: deck(1),
      artifacts: emptyArtifacts,
    });
    expect(stage).toBe("design");
  });

  it("resolves style when layout-plan exists", () => {
    const stage = resolvePromptStage({
      request: "执行标准排版",
      presentation: deck(3),
      artifacts: { ...emptyArtifacts, layoutPlan: true },
    });
    expect(stage).toBe("style");
  });

  it("accepts legacy stageHint", () => {
    const stage = resolvePromptStage({
      request: "x",
      presentation: deck(0),
      artifacts: emptyArtifacts,
      stageHint: "layout-exec",
    });
    expect(stage).toBe("style");
  });
});
