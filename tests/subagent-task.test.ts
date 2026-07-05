import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "../src/main/agent/runtime/agent-runtime";
import { spawnSubAgent, spawnSubAgentsParallel } from "../src/main/agent/subagent/spawn-subagent";
import { createTaskTool } from "../src/main/agent/tools/core/task";
import { ToolRegistry } from "../src/main/agent/tools/tool-registry";
import { submitCommandsTool } from "../src/main/agent/tools/core/submit-commands";
import type { AgentModelGateway } from "../src/main/agent/gateway";
import { createStarterPresentation } from "../src/shared/presentation";

function createSequenceGateway(responses: unknown[]): AgentModelGateway {
  let index = 0;
  return {
    async generateText() {
      const value = responses[index++];
      if (value === undefined) throw new Error("Unexpected gateway call");
      return {
        provider: "anthropic",
        model: "test-model",
        text: typeof value === "string" ? value : JSON.stringify(value),
      };
    },
    async *generateTextStream() {
      const value = responses[index++];
      if (value === undefined) throw new Error("Unexpected gateway call");
      const text = typeof value === "string" ? value : JSON.stringify(value);
      yield { type: "content" as const, text };
      yield { type: "complete" as const, text: "" };
    },
  };
}

function modelToolCall(toolName: string, args: Record<string, unknown> = {}) {
  return { type: "tool.call", data: { toolName, args } };
}

function modelMessage(content: string) {
  return { type: "assistant.message", data: { content } };
}

describe("Task sub-agent routing", () => {
  it("returns only the final conclusion and discards sub-agent transcript", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-subagent-"));
    const gateway = createSequenceGateway([
      modelToolCall("write_file", { path: "brief.md", content: "# Brief\nAudience: engineers" }),
      modelMessage("Created brief.md with audience and purpose."),
    ]);

    const conclusion = await spawnSubAgent({
      description: "Draft brief.md for an AI agent talk",
      workspaceRoot,
      gateway,
      requestToolApproval: async () => true,
    });

    expect(conclusion).toBe("Created brief.md with audience and purpose.");
    expect(await readFile(join(workspaceRoot, "brief.md"), "utf8")).toContain("Audience: engineers");
  });

  it("runs concurrent sub-agents with isolated contexts", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-subagent-"));
    let call = 0;
    const gateway: AgentModelGateway = {
      async generateText(request) {
        call += 1;
        const payload = JSON.parse(request.prompt) as { task: string };
        if (payload.task.includes("brief")) {
          return {
            provider: "anthropic",
            model: "test-model",
            text: JSON.stringify(modelMessage("Brief done.")),
          };
        }
        return {
          provider: "anthropic",
          model: "test-model",
          text: JSON.stringify(modelMessage("Outline done.")),
        };
      },
      async *generateTextStream() {
        yield { type: "complete" as const, text: "" };
      },
    };

    const results = await spawnSubAgentsParallel(
      ["Write brief", "Write outline"],
      { workspaceRoot, gateway },
    );

    expect(call).toBe(2);
    expect(results).toEqual(["Brief done.", "Outline done."]);
  });

  it("feeds only the Task conclusion back into the main agent transcript", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-subagent-"));
    const spawn = vi.fn(async () => "Sub-agent finished brief.md.");
    const taskTool = createTaskTool({ spawn });
    const gateway = createSequenceGateway([
      modelToolCall("Task", { description: "Draft brief.md" }),
      modelToolCall("SubmitCommands", {
          summary: "Set title",
          commands: [{ id: "cmd-1", type: "set-presentation-title", title: "Agent PPT" }],
          risk: "low",
      }),
    ]);

    const registry = new ToolRegistry();
    registry.register(taskTool);
    registry.register(submitCommandsTool);
    const runtime = new AgentRuntime(registry, gateway);
    const prompts: string[] = [];
    const wrappedGateway: AgentModelGateway = {
      async generateText(request, selection) {
        prompts.push(request.prompt);
        return gateway.generateText(request, selection);
      },
      generateTextStream: gateway.generateTextStream.bind(gateway),
    };
    const runtimeWithCapture = new AgentRuntime(registry, wrappedGateway);

    const result = await runtimeWithCapture.run({
      threadId: "task-thread",
      request: "Create an agent PPT",
      presentationSnapshot: createStarterPresentation(),
      selectedElementIds: [],
      workspaceRoot,
      requestToolApproval: async () => true,
    });

    expect(spawn).toHaveBeenCalledOnce();
    expect(result.type).toBe("deck.command_proposal");
    const secondPrompt = JSON.parse(prompts[1]!);
    expect(secondPrompt.transcript).toEqual([
      { role: "user", content: "Create an agent PPT" },
      {
        role: "tool",
        toolName: "Task",
        result: {
          conclusion: "Sub-agent finished brief.md.",
          subtaskCount: 1,
        },
      },
    ]);
    expect(JSON.stringify(secondPrompt.transcript)).not.toContain("Draft brief.md");
  });

  it("rejects sub-agent tool calls to task", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-subagent-"));
    const gateway = createSequenceGateway([
      modelToolCall("task", { description: "nested" }),
      modelMessage("Completed without delegating."),
    ]);

    const conclusion = await spawnSubAgent({
      description: "Do the work directly",
      workspaceRoot,
      gateway,
    });

    expect(conclusion).toBe("Completed without delegating.");
  });

  it("supports workspace edit_file in sub-agent tools", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-subagent-"));
    await writeFile(join(workspaceRoot, "outline.md"), "# Old title", "utf8");
    const gateway = createSequenceGateway([
      modelToolCall("edit_file", {
          path: "outline.md",
          old_string: "Old title",
          new_string: "New title",
      }),
      modelMessage("Updated outline title."),
    ]);

    await spawnSubAgent({
      description: "Rename outline title",
      workspaceRoot,
      gateway,
      requestToolApproval: async () => true,
    });

    expect(await readFile(join(workspaceRoot, "outline.md"), "utf8")).toBe("# New title");
  });
});
