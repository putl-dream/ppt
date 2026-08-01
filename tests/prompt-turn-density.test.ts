import { describe, expect, it } from "vitest";
import { askUserTool } from "../src/main/agent/tools/core/ask-user";
import { loadSkillTool } from "../src/main/agent/tools/core/load-skill";
import { previewSvgPageTool } from "../src/main/agent/tools/core/preview-svg-page";
import { readFileTool, writeFileTool } from "../src/main/agent/tools/core/workspace-files";
import { buildContentBlockResponseGuidance } from "../src/main/agent/runtime/prompts/response-guidance";
import {
  buildIdentitySection,
  buildToolsSection,
} from "../src/main/agent/runtime/prompts/prompt-sections";
import {
  formatSvgDeckLockBootstrapGuidance,
  formatSvgDeckLockContractBlock,
} from "../src/main/agent/tools/core/svg-deck-locks";

/**
 * Soft create-path habits that inflate turnCount (not hard runtime gates):
 * one LoadSkill per turn, write-one-page-preview-one-page, transition narration.
 * These assertions lock the denser prompt/skill contract that counters them.
 */
describe("prompt turn-density guidance", () => {
  it("identity asks for denser independent tool batches", () => {
    const identity = buildIdentitySection();
    expect(identity).toContain("降低模型往返");
    expect(identity).toContain("同一 assistant 响应");
    expect(identity).toContain("不要为了“看起来一步一步”而把独立工作拆成多轮");
  });

  it("tool selection lists batchable create-path patterns and bans transition narration", () => {
    const section = buildToolsSection({
      stage: "author",
      enabledTools: [
        askUserTool,
        loadSkillTool,
        readFileTool,
        writeFileTool,
        previewSvgPageTool,
      ],
    });
    expect(section).toContain("多个 LoadSkill");
    expect(section).toContain("同批写剩余 SVG");
    expect(section).toContain("同批多个 PreviewSvgPage");
    expect(section).toContain("过渡旁白");
    expect(section).toContain("只在开场说明目标");
  });

  it("omits create-path tool names from batch examples when those tools are absent", () => {
    const section = buildToolsSection({
      stage: "discover",
      enabledTools: [askUserTool],
    });
    expect(section).not.toContain("ReadFile");
    expect(section).not.toContain("WriteFile");
    expect(section).not.toContain("PreviewSvgPage");
    expect(section).toContain("过渡旁白");
  });

  it("response protocol discourages step narration between tool batches", () => {
    const protocol = buildContentBlockResponseGuidance();
    expect(protocol).toContain("不要用短段落复述即将执行的步骤");
    expect(protocol).toContain("过渡旁白");
  });

  it("SVG lock contract and bootstrap prefer batched skills and post-P01 bulk writes", () => {
    const contract = formatSvgDeckLockContractBlock();
    expect(contract).toContain("可同批加载多个 Skill");
    expect(contract).toContain("同批写剩余 SVG");
    expect(contract).toContain("SubmitSvgDeck（独批）");

    const bootstrap = formatSvgDeckLockBootstrapGuidance();
    expect(bootstrap).toContain("Batch LoadSkill");
    expect(bootstrap).toContain("batch-write remaining SVGs");
    expect(bootstrap).toContain("batch PreviewSvgPage");
  });

  it("LoadSkill tool card text allows multiple skills in one response", () => {
    expect(loadSkillTool.description).toContain("same assistant response");
    expect(loadSkillTool.description).toContain("do not open a new model turn per skill");
  });
});
