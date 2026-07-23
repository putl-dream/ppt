import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TEST_DESIGN_SYSTEM } from "./design-engine-test-utils";
import {
  probeWorkspaceArtifactDetails,
  probeWorkspaceArtifacts,
} from "../src/main/agent/runtime/presentation/workspace-artifacts";
import {
  createDefaultBriefMarkdown,
  createDefaultOutlineMarkdown,
} from "../src/shared/project-artifacts";
import { createDefaultStoryboardSlide } from "../src/shared/storyboard";
import { buildSystemPromptContext } from "../src/main/agent/runtime/prompts/prompt-context";
import { askUserTool } from "../src/main/agent/tools/core/ask-user";

async function createWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ppt-workspace-artifacts-"));
}

async function writeDefaultScaffold(root: string): Promise<void> {
  await mkdir(join(root, "slides"), { recursive: true });
  await writeFile(join(root, "brief.md"), createDefaultBriefMarkdown("测试项目"), "utf8");
  await writeFile(join(root, "outline.md"), createDefaultOutlineMarkdown("测试项目"), "utf8");
  await writeFile(
    join(root, "slides/storyboard.json"),
    `${JSON.stringify([createDefaultStoryboardSlide("测试项目", 0)], null, 2)}\n`,
    "utf8",
  );
}

describe("workspace artifact probing", () => {
  it("ignores scaffolded default project files", async () => {
    const root = await createWorkspace();
    await writeDefaultScaffold(root);

    await expect(probeWorkspaceArtifacts(root)).resolves.toEqual({
      brief: false,
      outline: false,
      storyboard: false,
      layoutPlan: false,
    });
  });

  it("detects a real outline after the default scaffold is edited", async () => {
    const root = await createWorkspace();
    await writeDefaultScaffold(root);
    await writeFile(
      join(root, "outline.md"),
      "# 演示大纲\n\n## 1. 会话隔离问题复盘 [预计 2 页]\n- 现象与影响\n- 修复方案\n",
      "utf8",
    );

    const artifacts = await probeWorkspaceArtifacts(root);
    expect(artifacts.outline).toBe(true);
    expect(artifacts.brief).toBe(false);
    expect(artifacts.storyboard).toBe(false);
  });

  it("accepts a detailed numbered outline without explicit page annotations", async () => {
    const root = await createWorkspace();
    await writeDefaultScaffold(root);
    await writeFile(
      join(root, "outline.md"),
      [
        "# PPT 内容大纲",
        "",
        "## 1. 封面",
        "- 建立主题与学习目标",
        "",
        "## 2. 核心分析",
        "- 拆解文章结构",
        "- 总结写作启示",
      ].join("\n"),
      "utf8",
    );

    await expect(probeWorkspaceArtifacts(root)).resolves.toMatchObject({ outline: true });
  });

  it("detects a brief with real content beyond the scaffold", async () => {
    const root = await createWorkspace();
    await writeDefaultScaffold(root);
    await writeFile(
      join(root, "brief.md"),
      `${createDefaultBriefMarkdown("测试项目")}\n## 背景\n- 需要复盘会话隔离漏洞。\n`,
      "utf8",
    );

    const artifacts = await probeWorkspaceArtifacts(root);
    expect(artifacts.brief).toBe(true);
    expect(artifacts.outline).toBe(false);
    expect(artifacts.storyboard).toBe(false);
  });

  it("does not treat invalid storyboard JSON as a usable artifact", async () => {
    const root = await createWorkspace();
    await writeDefaultScaffold(root);
    await writeFile(
      join(root, "slides/storyboard.json"),
      JSON.stringify({ slides: [{ title: "缺字段", keyPoints: [] }] }, null, 2),
      "utf8",
    );

    const artifacts = await probeWorkspaceArtifacts(root);
    const details = await probeWorkspaceArtifactDetails(root);

    expect(artifacts.storyboard).toBe(false);
    expect(details.storyboard.status).toBe("invalid");
    expect(details.storyboard.reason).toContain("lacks title, role, layout, or key points");
  });

  it("verifies generated storyboard objects with slides wrappers", async () => {
    const root = await createWorkspace();
    await writeDefaultScaffold(root);
    await writeFile(
      join(root, "slides/storyboard.json"),
      JSON.stringify({
        slides: [
          {
            slideId: "slide-cover",
            title: "PPT 智能助手",
            narrativeRole: "hook",
            layout: "cover",
            keyPoints: ["展示从一句话到完整演示的生成路径。"],
          },
          {
            slideId: "slide-plan",
            title: "智能规划",
            narrativeRole: "core",
            layout: "concept",
            keyPoints: ["将 brief、outline 和 storyboard 串成稳定流程。"],
          },
        ],
      }, null, 2),
      "utf8",
    );

    const artifacts = await probeWorkspaceArtifacts(root);
    const details = await probeWorkspaceArtifactDetails(root);

    expect(artifacts.storyboard).toBe(true);
    expect(details.storyboard.status).toBe("verified");
  });

  it("invalidates storyboard when its slide count drifts from the verified outline", async () => {
    const root = await createWorkspace();
    await writeDefaultScaffold(root);
    await writeFile(
      join(root, "outline.md"),
      "# 演示大纲\n\n## 1. 开场 [预计 1 页]\n- 建立主题\n\n## 2. 总结 [预计 1 页]\n- 收束价值\n",
      "utf8",
    );
    await writeFile(
      join(root, "slides/storyboard.json"),
      JSON.stringify({
        slides: [
          {
            slideId: "slide-cover",
            title: "开场",
            narrativeRole: "hook",
            layout: "cover",
            keyPoints: ["建立主题。"],
          },
          {
            slideId: "slide-extra",
            title: "额外页面",
            narrativeRole: "context",
            layout: "concept",
            keyPoints: ["这页没有出现在 outline 中。"],
          },
          {
            slideId: "slide-summary",
            title: "总结",
            narrativeRole: "takeaway",
            layout: "summary",
            keyPoints: ["收束价值。"],
          },
        ],
      }, null, 2),
      "utf8",
    );

    const artifacts = await probeWorkspaceArtifacts(root);
    const details = await probeWorkspaceArtifactDetails(root);

    expect(artifacts.outline).toBe(true);
    expect(artifacts.storyboard).toBe(false);
    expect(details.storyboard.status).toBe("invalid");
    expect(details.storyboard.reason).toContain("outline expects 2 pages");
  });

  it("keeps a greeting in discover when only default files exist", async () => {
    const root = await createWorkspace();
    await writeDefaultScaffold(root);

    const context = await buildSystemPromptContext({
      request: "你好呀",
      presentation: {
        id: "presentation-1",
        title: "测试项目",
        revision: 0,
        designSystem: TEST_DESIGN_SYSTEM,
        slides: [],
      },
      coreTools: [askUserTool],
      workspaceRoot: root,
    });

    expect(context.stage).toBe("discover");
    expect(context.artifacts).toEqual({
      brief: false,
      outline: false,
      storyboard: false,
      layoutPlan: false,
    });
  });
});
