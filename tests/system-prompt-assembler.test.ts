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
    expect(assembled.text).toContain("slide-1");
    expect(assembled.text).not.toContain("## 相关记忆");
  });

  it("author stage omits layout skills from catalog and set-theme examples", () => {
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
    expect(assembled.text).toContain("大纲/分镜已冻结");
    expect(assembled.text).toContain("内容规范化");
    expect(assembled.text).not.toMatch(/"type":"set-theme"/);
  });

  it("design stage freezes slide count and copy while planning layout", () => {
    const assembled = assembleSystemPrompt(baseContext({
      stage: "design",
    }));

    expect(assembled.text).toContain("页数与文案已冻结");
    expect(assembled.text).toContain("slides[] 必须与当前 snapshot 一一对应");
    expect(assembled.text).toContain("layout-plan");
  });

  it("style stage includes theme commands and layout skills", () => {
    const registry = createEmptySkillRegistry();
    registerSkillFromContent(registry, "/tmp/layout", "ppt-layout", LAYOUT_SKILL);

    const assembled = assembleSystemPrompt(baseContext({
      stage: "style",
      skillCatalog: registry.listCards(),
      skillRegistry: registry,
    }));

    expect(assembled.text).toContain("`ppt-layout`");
    expect(assembled.text).toContain("set-theme");
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
    expect(assembled.text).toContain("Markdown 写在 data.content 中");
    expect(assembled.text).toContain("不要立刻收集使用场景、受众、页数");
    expect(assembled.text).toContain("不要声称“刚才已经讲解");
  });

  it("documents structured JSON actions and text envelopes", () => {
    const assembled = assembleSystemPrompt(baseContext({ stage: "discover" }));

    expect(assembled.text).toContain("每次主 Agent 响应必须严格返回一个 JSON 对象");
    expect(assembled.text).toContain("RESPONSE_CONTRACT:agent-protocol");
    expect(assembled.text).toContain('"kind":"text","format":"markdown","type":"assistant.message"');
    expect(assembled.text).toContain("Markdown 只能放在 content 字符串里");
    expect(assembled.text).toContain("请求用户补充：必须调用 AskUser 工具");
  });

  it("keeps the response protocol in the stable prompt prefix", () => {
    const assembled = assembleSystemPrompt(baseContext({
      memories: "记住：封面用 hero",
    }));
    const split = splitSystemPromptPrefix(assembled.text);

    expect(split.staticPrefix).toContain("RESPONSE_CONTRACT:agent-protocol");
    expect(split.staticPrefix).toContain("## Core Tools");
    expect(split.dynamicSuffix).not.toContain("RESPONSE_CONTRACT:agent-protocol");
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

  it("resolves author when slides exist without theme", () => {
    const stage = resolvePromptStage({
      request: "继续写下一页",
      presentation: {
        ...createStarterPresentation(),
        slides: [{ id: "s1", title: "T", layout: "concept", elements: [] }],
      },
      artifacts: emptyArtifacts(),
    });
    expect(stage).toBe("author");
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
