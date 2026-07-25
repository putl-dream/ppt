import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { askUserTool } from "../src/main/agent/tools/core/ask-user";
import { loadSkillTool } from "../src/main/agent/tools/core/load-skill";
import { createDefaultToolRegistry } from "../src/main/agent/tools/tool-registry";
import {
  registerSkillFromContent,
  createEmptySkillRegistry,
} from "../src/main/agent/skills/loadSkillsDir";
import { createSkillSession } from "../src/main/agent/skills/skill-types";
import { createStarterPresentation } from "../src/shared/presentation";
import {
  buildSystemPromptContext,
  MEMORY_INDEX_RELATIVE_PATH,
} from "../src/main/agent/runtime/prompts/prompt-context";
import {
  assembleSystemPrompt,
  clearSystemPromptCache,
  getSystemPrompt,
  splitSystemPromptPrefix,
  SystemPromptManager,
} from "../src/main/agent/runtime/prompts/system-prompt-assembler";
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "../src/main/agent/runtime/prompts/prompt-sections";
import { SystemPromptBuilder } from "../src/main/agent/runtime/prompts/system-prompt";
import { resolvePromptStage } from "../src/main/agent/runtime/prompts/prompt-stage";

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
  it("keeps stable principles separate from query-specific capabilities and facts", () => {
    const assembled = assembleSystemPrompt(baseContext());
    const ids = assembled.sections.map((section) => section.id);

    expect(ids).toEqual([
      "identity",
      "responseProtocol",
      "runtimeContext",
      "tools",
      "workspace",
    ]);
    expect(assembled.staticPrefix).toContain("工程型智能体");
    expect(assembled.staticPrefix).toContain("provider 原生 tool_use");
    expect(assembled.staticPrefix).not.toContain('"name":"AskUser"');
    expect(assembled.dynamicSuffix).toContain('"name":"AskUser"');
    expect(assembled.dynamicSuffix).toContain("工作目录: /tmp/project");
    expect(assembled.dynamicSuffix).toContain("brief.md: missing/unverified");
    expect(assembled.dynamicSuffix).toContain("slide-1");
    expect(assembled.text).not.toContain("## 相关记忆");
  });

  it("describes an adaptive inspect-act-verify loop instead of a mandatory workflow", () => {
    const text = assembleSystemPrompt(baseContext()).text;

    expect(text).toContain("阶段标签只是上下文提示，不是控制流或能力白名单");
    expect(text).toContain("先检查必要事实，再修改，再验证");
    expect(text).toContain("简单任务直接完成");
    expect(text).toContain("已验证产物默认复用");
    expect(text).not.toContain("阶段契约：收敛而非发散");
    expect(text).not.toContain("当前仅执行本阶段");
    expect(text).not.toContain("主 Agent 可以直接执行的工作限于");
    expect(text).not.toContain("ReadFile");
    expect(text).not.toContain("SubmitCommands");
    expect(text).not.toContain("SearchExtraTools");
    expect(text).not.toContain("PreviewSlide");
  });

  it("shows every registered skill while ranking current recommendations first", () => {
    const registry = createEmptySkillRegistry();
    registerSkillFromContent(registry, "/tmp/build", "ppt-build", SAMPLE_SKILL);
    registerSkillFromContent(registry, "/tmp/layout", "ppt-layout", LAYOUT_SKILL);

    const text = assembleSystemPrompt(baseContext({
      stage: "author",
      skillCatalog: registry.listCards(),
      skillRegistry: registry,
    })).text;

    expect(text).toContain("`ppt-build` [当前上下文推荐]");
    expect(text).toContain("`ppt-layout`");
    expect(text).not.toContain("`ppt-layout` [当前上下文推荐]");
    expect(text.indexOf("`ppt-build`")).toBeLessThan(text.indexOf("`ppt-layout`"));
    expect(text).toContain("任何已注册 Skill 都保留");
  });

  it("allows loading a skill outside its suggested stage", async () => {
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

    const result = await loadSkillTool.execute(
      { skillName: "ppt-layout" },
      context as any,
    );
    expect(result.name).toBe("ppt-layout");
    expect(result.guidance).toContain("not normally suggested");
  });

  it("loads memory only when MEMORY.md has content", async () => {
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
    const assembled = assembleSystemPrompt(context);

    expect(context.memories).toContain("深色主题");
    expect(assembled.sections.map((section) => section.id)).toContain("memory");
    expect(assembled.dynamicSuffix).toContain("用户偏好深色主题");
  });

  it("does not infer a control-flow stage from request keywords", () => {
    const presentation = {
      ...createStarterPresentation(),
      slides: [{ id: "s1", title: "T", layout: "concept" as const, elements: [] }],
    };
    const exportRequest = resolvePromptStage({
      request: "请导出 PPT 文件",
      presentation,
      artifacts: emptyArtifacts(),
    });
    const authorRequest = resolvePromptStage({
      request: "继续写下一页",
      presentation,
      artifacts: emptyArtifacts(),
    });

    expect(exportRequest).toBe("edit");
    expect(authorRequest).toBe(exportRequest);
  });

  it("honors an explicit stage hint without hiding other capabilities", () => {
    const stage = resolvePromptStage({
      request: "执行已确认的设计方向",
      presentation: createStarterPresentation(),
      artifacts: emptyArtifacts(),
      stageHint: "layout-design",
    });
    expect(stage).toBe("design");
  });

  it("caches unchanged contexts per thread and rebuilds dynamic changes", () => {
    clearSystemPromptCache();
    const context = baseContext();
    const first = getSystemPrompt(context, "thread-a");
    const same = getSystemPrompt(context, "thread-a");
    const changed = getSystemPrompt(baseContext({ stage: "style" }), "thread-a");

    expect(same).toBe(first);
    expect(changed).not.toBe(first);
    expect(changed.staticPrefix).toBe(first.staticPrefix);
    expect(changed.dynamicSuffix).not.toBe(first.dynamicSuffix);
  });

  it("invalidates a thread cache when a same-name tool contract changes", () => {
    clearSystemPromptCache();
    const first = getSystemPrompt(baseContext(), "thread-tool-contract");
    const changedTool = {
      ...askUserTool,
      description: "Updated interaction contract",
      inputSchema: z.object({
        decision: z.enum(["accept", "reject"]).describe("Required decision"),
      }),
      risk: "medium" as const,
      permission: {
        profile: "interactive-approval",
        description: "Always ask before interacting.",
        scopes: ["main" as const],
        effects: ["user.interaction" as const],
        sandbox: "none" as const,
        approval: "always" as const,
      },
    };
    const second = getSystemPrompt(baseContext({
      coreTools: [changedTool],
    }), "thread-tool-contract");

    expect(second).not.toBe(first);
    expect(second.dynamicSuffix).toContain("Updated interaction contract");
    expect(second.dynamicSuffix).toContain("decision");
    expect(second.dynamicSuffix).toContain('"risk":"medium"');
  });

  it("invalidates a thread cache when same-name Skill frontmatter changes", () => {
    clearSystemPromptCache();
    const authorRegistry = createEmptySkillRegistry();
    registerSkillFromContent(authorRegistry, "/tmp/build-author", "ppt-build", SAMPLE_SKILL);
    const first = getSystemPrompt(baseContext({
      stage: "author",
      skillCatalog: authorRegistry.listCards(),
      skillRegistry: authorRegistry,
    }), "thread-skill-contract");

    const styleRegistry = createEmptySkillRegistry();
    registerSkillFromContent(
      styleRegistry,
      "/tmp/build-style",
      "ppt-build",
      SAMPLE_SKILL.replace("  - author", "  - style"),
    );
    const second = getSystemPrompt(baseContext({
      stage: "author",
      skillCatalog: styleRegistry.listCards(),
      skillRegistry: styleRegistry,
    }), "thread-skill-contract");

    expect(second).not.toBe(first);
    expect(first.dynamicSuffix).toContain("`ppt-build` [当前上下文推荐]");
    expect(second.dynamicSuffix).not.toContain("`ppt-build` [当前上下文推荐]");
  });

  it("supports independently registered, ordered prompt sections", () => {
    const manager = new SystemPromptManager([
      {
        id: "feature-context",
        order: 30,
        cacheScope: null,
        render: (context) => `feature:${context.currentSlideId}`,
      },
      {
        id: "feature-principles",
        order: 10,
        cacheScope: "global",
        render: () => "stable feature principles",
      },
    ]);

    const assembled = manager.assemble(baseContext());
    expect(assembled.sections.map((section) => section.id)).toEqual([
      "feature-principles",
      "feature-context",
    ]);
    expect(assembled.staticPrefix).toBe("stable feature principles");
    expect(assembled.dynamicSuffix).toBe("feature:slide-1");
  });

  it("places the explicit cache boundary between stable and dynamic sections", () => {
    const assembled = assembleSystemPrompt(baseContext({
      memories: "记住：封面用 hero",
    }));
    const split = splitSystemPromptPrefix(assembled.text);

    expect(assembled.text).toContain(SYSTEM_PROMPT_DYNAMIC_BOUNDARY);
    expect(split.staticPrefix).toContain("工程型智能体");
    expect(split.dynamicSuffix).toContain("记住：封面用 hero");
  });

  it("injects skill cards without eagerly copying SKILL.md bodies", () => {
    const registry = createEmptySkillRegistry();
    registerSkillFromContent(
      registry,
      "/tmp/pdf",
      "pdf",
      SAMPLE_SKILL.replace("ppt-build", "pdf"),
    );

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

  it("documents the memory path constant", () => {
    expect(MEMORY_INDEX_RELATIVE_PATH).toBe(".memory/MEMORY.md");
  });
});
