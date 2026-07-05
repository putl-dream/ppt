import { describe, expect, it } from "vitest";
import { buildSubAgentSystemPrompt } from "../src/main/agent/subagent/sub-system-prompt";
import { SUB_AGENT_TOOLS } from "../src/main/agent/subagent/workspace-tools";

describe("sub-agent system prompt", () => {
  it("directs file operations to workspace tools before bash", () => {
    const prompt = buildSubAgentSystemPrompt(SUB_AGENT_TOOLS);

    expect(prompt).toContain("`write_file` automatically creates parent directories");
    expect(prompt).toContain("Do not call `bash` for mkdir/cat/echo redirection/copy/move style file operations");
    expect(prompt.indexOf("- write_file")).toBeLessThan(prompt.indexOf("- bash"));
  });
});
