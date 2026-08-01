import { describe, expect, it } from "vitest";
import { buildTeammateSystemPrompt } from "../src/main/agent/teammate/teammate-system-prompt";
import { SUB_AGENT_TOOLS } from "../src/main/agent/subagent/workspace-tools";

describe("teammate image-search prompt", () => {
  it("makes image search mandatory for image-dependent SVG pages", () => {
    const prompt = buildTeammateSystemPrompt({
      name: "designer",
      role: "layout designer",
      tools: SUB_AGENT_TOOLS,
    });

    expect(prompt).toContain("include_images");
    expect(prompt).toContain("2–4 unique");
    expect(prompt).toContain("web_search");
    expect(prompt).toContain("Embed images in page SVG");
    expect(prompt).toContain("SearchSlideImages");
    expect(prompt).not.toContain("insert-image enhancement");
  });
});
