import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseSkillFrontmatterFields,
  readFrontmatterString,
} from "../src/main/agent/skills/parseSkillFrontmatterFields";
import {
  registerSkillFromContent,
  scanSkills,
  createEmptySkillRegistry,
  listSkills,
} from "../src/main/agent/skills/loadSkillsDir";
import { loadSkillTool } from "../src/main/agent/tools/core/load-skill";
import { createSkillSession } from "../src/main/agent/skills/skill-types";
import { createStarterPresentation } from "../src/shared/presentation";
import { SystemPromptBuilder } from "../src/main/agent/runtime/system-prompt";
import { askUserTool } from "../src/main/agent/tools/core/ask-user";
import { createDefaultToolRegistry } from "../src/main/agent/tools/tool-registry";

const SAMPLE_SKILL = `---
name: code-review
description: Review code changes for bugs and style issues
when_to_use: User asks for a PR or code review
stages:
  - content
  - routing
allowed-tools:
  - Read
  - Grep
context: inline
---

# Code Review

Follow team standards.
`;

describe("load_skill two-layer design", () => {
  it("parseSkillFrontmatterFields extracts YAML fields and body", () => {
    const parsed = parseSkillFrontmatterFields(SAMPLE_SKILL);

    expect(readFrontmatterString(parsed.frontmatter, "name")).toBe("code-review");
    expect(readFrontmatterString(parsed.frontmatter, "description")).toContain("Review code");
    expect(readFrontmatterString(parsed.frontmatter, "when_to_use")).toContain("code review");
    expect(parsed.body).toContain("# Code Review");
    expect(parsed.body).not.toContain("---");
  });

  it("scanSkills builds registry from skills/ subdirectories", async () => {
    const root = await mkdtemp(join(tmpdir(), "ppt-skills-"));
    const skillDir = join(root, "pdf");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), SAMPLE_SKILL.replace("code-review", "pdf"));

    const registry = await scanSkills(root);
    const cards = listSkills(registry);

    expect(cards).toHaveLength(1);
    expect(cards[0].name).toBe("pdf");
    expect(registry.get("pdf")?.body).toContain("# Code Review");
  });

  it("LoadSkill resolves by registry name and rejects unknown skills", async () => {
    const registry = createEmptySkillRegistry();
    registerSkillFromContent(registry, "/tmp/pdf", "pdf", SAMPLE_SKILL.replace("code-review", "pdf"));

    const skillSession = createSkillSession();
    const context = {
      presentation: createStarterPresentation(),
      selectedElementIds: [],
      discoverySession: { discoveredToolNames: new Set<string>() },
      registry: createDefaultToolRegistry(),
      messageHistory: [],
      skillRegistry: registry,
      skillSession,
      promptStage: "content" as const,
    };

    const result = await loadSkillTool.execute({ skillName: "pdf" }, context as any);
    expect(result.name).toBe("pdf");
    expect(result.content).toContain("# Code Review");
    expect(result.alreadyLoaded).toBe(false);
    expect(skillSession.loadedSkillNames.has("pdf")).toBe(true);

    const again = await loadSkillTool.execute({ skillName: "pdf" }, context as any);
    expect(again.alreadyLoaded).toBe(true);

    await expect(loadSkillTool.execute({ skillName: "../../../etc/passwd" }, context as any))
      .rejects.toThrow("Unknown skill");
  });

  it("SystemPromptBuilder injects skill catalog without full SKILL.md body", () => {
    const registry = createEmptySkillRegistry();
    registerSkillFromContent(registry, "/tmp/pdf", "pdf", SAMPLE_SKILL.replace("code-review", "pdf"));

    const prompt = SystemPromptBuilder.build({
      request: "写幻灯片",
      presentation: createStarterPresentation(),
      coreTools: [askUserTool],
      skillCatalog: registry.listCards(),
      skillRegistry: registry,
      stageHint: "content",
    });

    expect(prompt).toContain("## Available Skills");
    expect(prompt).toContain("`pdf`");
    expect(prompt).toContain("Review code");
    expect(prompt).toContain("LoadSkill");
    expect(prompt).not.toContain("# Code Review");
  });

  it("createDefaultToolRegistry includes LoadSkill core tool", () => {
    const registry = createDefaultToolRegistry();
    expect(registry.get("LoadSkill")?.loadPolicy).toBe("core");
    expect(registry.get("LoadSkill")?.category).toBe("core");
  });
});
