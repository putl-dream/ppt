import { describe, expect, it } from "vitest";
import { buildTeammateSystemPrompt } from "../src/main/agent/teammate/teammate-system-prompt";
import { SUB_AGENT_TOOLS } from "../src/main/agent/subagent/workspace-tools";

describe("teammate image-search prompt", () => {
  it("makes image search mandatory for image-dependent layout plans", () => {
    const prompt = buildTeammateSystemPrompt({
      name: "designer",
      role: "layout designer",
      tools: SUB_AGENT_TOOLS,
    });

    expect(prompt).toContain("image-grid or case/evidence");
    expect(prompt).toContain("include_images=true");
    expect(prompt).toContain("insert-image enhancement");
    expect(prompt).toContain("2–4 unique");
    expect(prompt).toContain("web_search");
  });
});
