import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { askUserTool } from "../src/main/agent/tools/core/ask-user";
import { createDefaultToolRegistry } from "../src/main/agent/tools/tool-registry";
import { registerSkillFromContent, createEmptySkillRegistry } from "../src/main/agent/skills/loadSkillsDir";
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

const SAMPLE_SKILL = `---
name: ppt-build
description: Build slide content drafts
---
# Build
`;

describe("system prompt assembly", () => {
  it("always includes identity, tools, and workspace sections", () => {
    const context = {
      enabledTools: ["AskUser"],
      memories: "",
      coreTools: [askUserTool],
      currentSlideId: "slide-1",
      workspaceRoot: "/tmp/project",
    };

    const assembled = assembleSystemPrompt(context);
    const ids = assembled.sections.map((section) => section.id);

    expect(ids).toEqual(["identity", "tools", "workspace"]);
    expect(assembled.text).toContain("PPT 智能助手");
    expect(assembled.text).toContain("AskUser");
    expect(assembled.text).toContain("工作目录: /tmp/project");
    expect(assembled.text).toContain("slide-1");
    expect(assembled.text).not.toContain("## 相关记忆");
  });

  it("loads memory section only when MEMORY.md has content", async () => {
    const root = await mkdtemp(join(tmpdir(), "ppt-memory-"));
    const memoryDir = join(root, ".memory");
    await mkdir(memoryDir, { recursive: true });
    await writeFile(join(memoryDir, "MEMORY.md"), "用户偏好深色主题\n", "utf8");

    const context = await buildSystemPromptContext({
      coreTools: [askUserTool],
      workspaceRoot: root,
    });

    expect(context.memories).toContain("深色主题");

    const assembled = assembleSystemPrompt(context);
    expect(assembled.sections.map((section) => section.id)).toContain("memory");
    expect(assembled.text).toContain("## 相关记忆");
    expect(assembled.text).toContain("用户偏好深色主题");
  });

  it("skips memory section when MEMORY.md is missing or empty", async () => {
    const root = await mkdtemp(join(tmpdir(), "ppt-no-memory-"));

    const missing = await buildSystemPromptContext({
      coreTools: [askUserTool],
      workspaceRoot: root,
    });
    expect(assembleSystemPrompt(missing).sections.map((section) => section.id)).not.toContain("memory");

    const memoryDir = join(root, ".memory");
    await mkdir(memoryDir, { recursive: true });
    await writeFile(join(memoryDir, "MEMORY.md"), "   \n", "utf8");

    const empty = await buildSystemPromptContext({
      coreTools: [askUserTool],
      workspaceRoot: root,
    });
    expect(empty.memories).toBe("");
    expect(assembleSystemPrompt(empty).sections.map((section) => section.id)).not.toContain("memory");
  });

  it("caches assembled prompt per thread when context is unchanged", () => {
    clearSystemPromptCache();
    const context = {
      enabledTools: ["AskUser"],
      memories: "",
      coreTools: [askUserTool],
    };

    const first = getSystemPrompt(context, "thread-a");
    const second = getSystemPrompt(context, "thread-a");

    expect(second).toBe(first);
    expect(first.text).toBe(second.text);
  });

  it("rebuilds prompt when context changes", () => {
    clearSystemPromptCache();
    const base = {
      enabledTools: ["AskUser"],
      memories: "",
      coreTools: [askUserTool],
    };

    const first = getSystemPrompt({ ...base, currentSlideId: "slide-1" }, "thread-b");
    const second = getSystemPrompt({ ...base, currentSlideId: "slide-2" }, "thread-b");

    expect(second.text).not.toBe(first.text);
    expect(second.text).toContain("slide-2");
  });

  it("places dynamic boundary between static and dynamic sections", () => {
    const context = {
      enabledTools: ["AskUser"],
      memories: "记住：封面用 hero",
      coreTools: [askUserTool],
      workspaceRoot: "/tmp/ws",
    };

    const assembled = assembleSystemPrompt(context);
    expect(assembled.text).toContain(SYSTEM_PROMPT_DYNAMIC_BOUNDARY);

    const split = splitSystemPromptPrefix(assembled.text);
    expect(split.staticPrefix).toContain("PPT 智能助手");
    expect(split.staticPrefix).toContain("AskUser");
    expect(split.staticPrefix).not.toContain("工作目录");
    expect(split.dynamicSuffix).toContain("工作目录");
    expect(split.dynamicSuffix).toContain("记住：封面用 hero");
  });

  it("SystemPromptBuilder injects skill catalog without full SKILL.md body", () => {
    const registry = createEmptySkillRegistry();
    registerSkillFromContent(registry, "/tmp/pdf", "pdf", SAMPLE_SKILL);

    const prompt = SystemPromptBuilder.build({
      coreTools: [askUserTool],
      skillCatalog: registry.listCards(),
    });

    expect(prompt).toContain("## Available Skills");
    expect(prompt).toContain("`ppt-build`");
    expect(prompt).toContain("LoadSkill");
    expect(prompt).not.toContain("# Build");
  });

  it("enabled tools reflect actual registry, not hardcoded list", () => {
    const registry = createDefaultToolRegistry();
    const context = {
      enabledTools: registry.getCoreTools().map((tool) => tool.name).sort(),
      memories: "",
      coreTools: registry.getCoreTools(),
    };

    const assembled = assembleSystemPrompt(context);
    expect(assembled.text).toContain("ReadPresentationSnapshot");
    expect(assembled.text).toContain("SubmitCommands");
  });

  it("clearSystemPromptCache() clears all thread caches", () => {
    clearSystemPromptCache();
    const context = {
      enabledTools: ["AskUser"],
      memories: "",
      coreTools: [askUserTool],
    };

    const cached = getSystemPrompt(context, "thread-clear");
    clearSystemPromptCache();
    const rebuilt = getSystemPrompt(context, "thread-clear");

    expect(rebuilt).not.toBe(cached);
    expect(rebuilt.text).toBe(cached.text);
  });

  it("documents memory path constant", () => {
    expect(MEMORY_INDEX_RELATIVE_PATH).toBe(".memory/MEMORY.md");
  });
});
