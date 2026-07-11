import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { askUserTool } from "../src/main/agent/tools/core/ask-user";
import { loadSkillTool } from "../src/main/agent/tools/core/load-skill";
import { createDefaultToolRegistry } from "../src/main/agent/tools/tool-registry";
import { registerSkillFromContent, createEmptySkillRegistry } from "../src/main/agent/skills/loadSkillsDir";
import { createSkillSession } from "../src/main/agent/skills/skill-types";
import { createStarterPresentation } from "../src/shared/presentation";
import {
  buildSystemPromptContext,
  MEMORY_INDEX_RELATIVE_PATH,
} from "../src/main/agent/runtime/prompt-context";
import {
  assembleSystemPrompt,
  clearSystemPromptCache,
  getSystemPrompt,
  splitSystemPromptPrefix,
} from "../src/main/agent/runtime/system-prompt-assembler";
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "../src/main/agent/runtime/prompt-sections";
import { SystemPromptBuilder } from "../src/main/agent/runtime/system-prompt";
import { resolvePromptStage } from "../src/main/agent/runtime/prompt-stage";

const SAMPLE_SKILL = `---
name: ppt-build
description: Build slide content drafts
stages:
  - author
---
# Build
`;

const LAYOUT_SKILL = `---
name: ppt-layout
description: Apply visual layout
stages:
  - style
---
# Layout
`;

function emptyArtifacts() {
  return { brief: false, outline: false, storyboard: false, layoutPlan: false };
}

function baseContext(overrides: Record<string, unknown> = {}) {
  return {
    stage: "discover" as const,
    artifacts: emptyArtifacts(),
    enabledTools: ["AskUser"],
    memories: "",
    coreTools: [askUserTool],
    currentSlideId: "slide-1",
    workspaceRoot: "/tmp/project",
    ...overrides,
  };
}

describe("system prompt assembly", () => {
  it("always includes identity, tools, and workspace sections", () => {
    const assembled = assembleSystemPrompt(baseContext());
    const ids = assembled.sections.map((section) => section.id);

    expect(ids).toEqual(["identity", "responseProtocol", "tools", "workspace"]);
    expect(assembled.text).toContain("PPT 智能助手");
    expect(assembled.text).toContain("AskUser");
    expect(assembled.text).toContain("工作目录: /tmp/project");
    expect(assembled.text).toContain("Workflow Artifact State");
    expect(assembled.text).toContain("brief.md: missing/unverified");
    expect(assembled.text).toContain("slide-1");
    expect(assembled.text).not.toContain("## 相关记忆");
  });

  it("frames the main agent as a lead orchestrator with autonomous teammate claiming", () => {
    const assembled = assembleSystemPrompt(baseContext());

    expect(assembled.text).toContain("Lead Agent 职责边界");
    expect(assembled.text).toContain("lead/orchestrator");
    expect(assembled.text).toContain("维护 TaskGraph");
    expect(assembled.text).toContain("常驻 teammate 自主认领");
    expect(assembled.text).toContain("executionTarget");
    expect(assembled.text).toContain("submitted");
    expect(assembled.text).toContain("不要对已建图节点再调用 `Task` 重复委派");
    expect(assembled.text).toContain("不要创建临时、平面的任务列表");
    expect(assembled.text).toContain("覆盖当前用户目标的端到端计划");
    expect(assembled.text).toContain("同一个用户目标只建一张 TaskGraph");
    expect(assembled.text).toContain("不要因为进入 author/design/style 再调用 `TaskGraphCreatePlan`");
    expect(assembled.text).toContain("验收 teammate 提交的产物");
  });

  it("author stage omits layout skills from catalog and design-system examples", () => {
    const registry = createEmptySkillRegistry();
    registerSkillFromContent(registry, "/tmp/build", "ppt-build", SAMPLE_SKILL);
    registerSkillFromContent(registry, "/tmp/layout", "ppt-layout", LAYOUT_SKILL);

    const assembled = assembleSystemPrompt(baseContext({
      stage: "author",
      skillCatalog: registry.listCards(),
      skillRegistry: registry,
    }));

    expect(assembled.text).toContain("`ppt-build`");
    expect(assembled.text).not.toContain("`ppt-layout`");
    expect(assembled.text).toContain("充分写内容");
    expect(assembled.text).toContain("不要新建 TaskGraphCreatePlan");
    expect(assembled.text).toContain("大纲/分镜已冻结");
    expect(assembled.text).toContain("内容规范化");
    expect(assembled.text).not.toMatch(/"type":"set-design-system"/);
  });

  it("design stage freezes slide count and copy while executing confirmed layout", () => {
    const assembled = assembleSystemPrompt(baseContext({
      stage: "design",
    }));

    expect(assembled.text).toContain("页数与文案已冻结");
    expect(assembled.text).toContain("slides[] 必须与当前 snapshot 一一对应");
    expect(assembled.text).toContain("layout-plan");
    expect(assembled.text).toContain("ExecuteLayoutPlan");
    expect(assembled.text).toContain("set-design-system");
    expect(assembled.text).toContain("update-slide-layout");
    expect(assembled.text).toContain("不要再次输出");
    expect(assembled.text).not.toContain("不直接 SubmitCommands 改 deck");
  });

  it("style stage includes design-system commands and layout skills", () => {
    const registry = createEmptySkillRegistry();
    registerSkillFromContent(registry, "/tmp/layout", "ppt-layout", LAYOUT_SKILL);

    const assembled = assembleSystemPrompt(baseContext({
      stage: "style",
      skillCatalog: registry.listCards(),
      skillRegistry: registry,
    }));

    expect(assembled.text).toContain("`ppt-layout`");
    expect(assembled.text).toContain("ExecuteLayoutPlan");
    expect(assembled.text).toContain("视觉排版");
  });

  it("includes six-stage workflow overview in every stage", () => {
    const assembled = assembleSystemPrompt(baseContext({ stage: "discover" }));
    expect(assembled.text).toContain("`discover` → `author` → `design` → `style` → `export`");
    expect(assembled.text).toContain("阶段契约：收敛而非发散");
  });

  it("allows informational detours before PPT production workflow", () => {
    const assembled = assembleSystemPrompt(baseContext({ stage: "discover" }));

    expect(assembled.text).toContain("意图优先：先回答用户当下问题");
    expect(assembled.text).toContain("先不做 PPT");
    expect(assembled.text).toContain("直接用 Markdown 文本");
    expect(assembled.text).toContain("不要立刻收集使用场景、受众、页数");
    expect(assembled.text).toContain("不要声称“刚才已经讲解");
  });

  it("documents direct text and native tool_use responses", () => {
    const assembled = assembleSystemPrompt(baseContext({ stage: "discover" }));

    expect(assembled.text).toContain("直接输出 Markdown 文本");
    expect(assembled.text).toContain("provider 原生 tool_use");
    expect(assembled.text).not.toContain("RESPONSE_CONTRACT:agent-protocol");
    expect(assembled.text).not.toContain("assistant.message");
    expect(assembled.text).toContain("请求用户补充必须调用 AskUser");
  });

  it("keeps the response protocol in the stable prompt prefix", () => {
    const assembled = assembleSystemPrompt(baseContext({
      memories: "记住：封面用 hero",
    }));
    const split = splitSystemPromptPrefix(assembled.text);

    expect(split.staticPrefix).toContain("provider 原生 tool_use");
    expect(split.staticPrefix).toContain("## Core Tools");
    expect(split.dynamicSuffix).not.toContain("provider 原生 tool_use");
  });

  it("loads memory section only when MEMORY.md has content", async () => {
    const root = await mkdtemp(join(tmpdir(), "ppt-memory-"));
    const memoryDir = join(root, ".memory");
    await mkdir(memoryDir, { recursive: true });
    await writeFile(join(memoryDir, "MEMORY.md"), "用户偏好深色主题\n", "utf8");

    const context = await buildSystemPromptContext({
      request: "hello",
      presentation: createStarterPresentation(),
      coreTools: [askUserTool],
      workspaceRoot: root,
    });

    expect(context.memories).toContain("深色主题");

    const assembled = assembleSystemPrompt(context);
    expect(assembled.sections.map((section) => section.id)).toContain("memory");
    expect(assembled.text).toContain("用户偏好深色主题");
  });

  it("resolves design from layout phase user request", () => {
    const stage = resolvePromptStage({
      request: "请对当前演示文稿执行标准排版（第二阶段）。",
      presentation: {
        ...createStarterPresentation(),
        slides: [{ id: "s1", title: "T", layout: "concept", elements: [] }],
      },
      artifacts: emptyArtifacts(),
    });
    expect(stage).toBe("design");
  });

  it("resolves edit when existing slides are already laid out", () => {
    const stage = resolvePromptStage({
      request: "继续写下一页",
      presentation: {
        ...createStarterPresentation(),
        slides: [{ id: "s1", title: "T", layout: "concept", elements: [] }],
      },
      artifacts: emptyArtifacts(),
    });
    expect(stage).toBe("edit");
  });

  it("LoadSkill rejects layout skill during author stage", async () => {
    const registry = createEmptySkillRegistry();
    registerSkillFromContent(registry, "/tmp/layout", "ppt-layout", LAYOUT_SKILL);

    const context = {
      presentation: createStarterPresentation(),
      selectedElementIds: [],
      discoverySession: { discoveredToolNames: new Set<string>() },
      registry: createDefaultToolRegistry(),
      messageHistory: [],
      skillRegistry: registry,
      skillSession: createSkillSession(),
      promptStage: "author" as const,
    };

    await expect(loadSkillTool.execute({ skillName: "ppt-layout" }, context as any))
      .rejects.toThrow("not available in stage 'author'");
  });

  it("caches assembled prompt per thread when context is unchanged", () => {
    clearSystemPromptCache();
    const context = baseContext();

    const first = getSystemPrompt(context, "thread-a");
    const second = getSystemPrompt(context, "thread-a");

    expect(second).toBe(first);
  });

  it("rebuilds prompt when stage changes", () => {
    clearSystemPromptCache();
    const first = getSystemPrompt(baseContext({ stage: "author" }), "thread-b");
    const second = getSystemPrompt(baseContext({ stage: "style" }), "thread-b");

    expect(second.text).not.toBe(first.text);
  });

  it("places dynamic boundary between static and dynamic sections", () => {
    const assembled = assembleSystemPrompt(baseContext({
      memories: "记住：封面用 hero",
    }));

    expect(assembled.text).toContain(SYSTEM_PROMPT_DYNAMIC_BOUNDARY);
    const split = splitSystemPromptPrefix(assembled.text);
    expect(split.staticPrefix).toContain("PPT 智能助手");
    expect(split.dynamicSuffix).toContain("记住：封面用 hero");
  });

  it("SystemPromptBuilder injects skill catalog without full SKILL.md body", () => {
    const registry = createEmptySkillRegistry();
    registerSkillFromContent(registry, "/tmp/pdf", "pdf", SAMPLE_SKILL.replace("ppt-build", "pdf"));

    const prompt = SystemPromptBuilder.build({
      request: "写内容草稿",
      presentation: createStarterPresentation(),
      coreTools: [askUserTool],
      skillCatalog: registry.listCards(),
      skillRegistry: registry,
      stageHint: "author",
    });

    expect(prompt).toContain("## Available Skills");
    expect(prompt).toContain("`pdf`");
    expect(prompt).not.toContain("# Build");
  });

  it("documents memory path constant", () => {
    expect(MEMORY_INDEX_RELATIVE_PATH).toBe(".memory/MEMORY.md");
  });
});
