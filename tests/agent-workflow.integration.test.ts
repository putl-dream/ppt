import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { AgentGateway } from "../src/main/agent/gateway";
import { createModelPresentationPlanner } from "../src/main/agent/planner";
import { createModelOutlinePlanner } from "../src/main/agent/outline-planner";
import { AgentService } from "../src/main/agent/workflow";
import { CommandBus } from "../src/shared/commands";
import { createStarterPresentation } from "../src/shared/presentation";

let config: Record<string, string | undefined>;

function required(name: string): string {
  const value = config[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

beforeAll(async () => {
  config = parseEnv(await readFile(resolve(".env"), "utf8"));
  for (const key of ["OPENAI_BASE_URL", "OPENAI_API_MODE", "AGENT_TIMEOUT_MS", "AGENT_MAX_OUTPUT_TOKENS"] as const) {
    const value = config[key]?.trim();
    if (value) process.env[key] = value;
  }
});

describe("real model Agent workflow integration", () => {
  it(
    "plans, validates, and applies a real model response",
    async () => {
      const bus = new CommandBus(createStarterPresentation());
      const gateway = new AgentGateway();
      const selection = gateway.configure({
        provider: "openai",
        model: required("OPENAI_MODEL"),
        apiKey: required("OPENAI_API_KEY"),
      });
      const agent = new AgentService(
        bus,
        createModelPresentationPlanner(gateway),
        createModelOutlinePlanner(gateway),
      );

      const outlineResult = await agent.start(
        "创建一份智能硬件市场推广策划大纲",
        selection,
        "AUTO",
      );
      expect(outlineResult.status).toBe("chat");
      if (outlineResult.status !== "chat") throw new Error("Expected outline request");
      const result = await agent.continueAgentRun(outlineResult.threadId!, "确认大纲，生成 PPT");

      expect(result.status).toBe("completed");
      expect(bus.getSnapshot().title).not.toBe("Untitled presentation");
      expect(bus.getSnapshot().revision).toBeGreaterThan(0);
    },
    120_000,
  );

  it(
    "plans and applies through an Anthropic-compatible custom endpoint",
    async () => {
      const bus = new CommandBus(createStarterPresentation());
      const gateway = new AgentGateway();
      const selection = gateway.configure({
        provider: "anthropic",
        model: required("ANTHROPIC_MODEL"),
        apiKey: required("ANTHROPIC_API_KEY"),
        baseURL: required("ANTHROPIC_BASE_URL"),
      });
      const agent = new AgentService(
        bus,
        createModelPresentationPlanner(gateway),
        createModelOutlinePlanner(gateway),
      );

      const result = await agent.start(
        "将演示文稿标题修改为 MiniMax Agent 验证，不要进行其他修改。",
        selection,
        "AUTO",
      );

      expect(result.status).toBe("completed");
      expect(bus.getSnapshot().title).toContain("MiniMax Agent 验证");
    },
    120_000,
  );
});
