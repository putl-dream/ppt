import { describe, expect, it } from "vitest";
import {
  applyResponseContract,
  buildAgentProtocolResponseContract,
  buildResponseContract,
} from "../src/main/agent/gateway/response-contract";

describe("response contracts", () => {
  it("appends the agent protocol contract only when missing", () => {
    const prompt = "You are a PPT assistant.";
    const once = applyResponseContract(prompt, "agent-protocol");
    const twice = applyResponseContract(once, "agent-protocol");

    expect(once).toContain("RESPONSE_CONTRACT:agent-protocol");
    expect(once).toContain('"kind":"text","format":"markdown","type":"assistant.message"');
    expect(twice).toBe(once);
  });

  it("keeps calls without a contract unchanged", () => {
    expect(applyResponseContract("system", "none")).toBe("system");
    expect(applyResponseContract("system", undefined)).toBe("system");
  });

  it("defines a separate markdown summary contract", () => {
    const contract = buildResponseContract("markdown-summary");

    expect(contract).toContain("RESPONSE_CONTRACT:markdown-summary");
    expect(contract).toContain("plain Markdown summary text only");
    expect(contract).not.toContain("assistant.message");
  });

  it("exposes the same agent protocol text used by system prompt sections", () => {
    expect(buildAgentProtocolResponseContract()).toContain("## 响应协议");
    expect(buildAgentProtocolResponseContract()).toContain("提交幻灯片修改：必须调用 SubmitCommands");
  });
});
