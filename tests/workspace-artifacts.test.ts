import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { probeWorkspaceArtifacts } from "../src/main/agent/runtime/workspace-artifacts";
import {
  createDefaultBriefMarkdown,
  createDefaultOutlineMarkdown,
} from "../src/shared/project-artifacts";
import { createDefaultStoryboardSlide } from "../src/shared/storyboard";
import { buildSystemPromptContext } from "../src/main/agent/runtime/prompt-context";
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

  it("keeps a greeting in discover when only default files exist", async () => {
    const root = await createWorkspace();
    await writeDefaultScaffold(root);

    const context = await buildSystemPromptContext({
      request: "你好呀",
      presentation: {
        id: "presentation-1",
        title: "测试项目",
        revision: 0,
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
