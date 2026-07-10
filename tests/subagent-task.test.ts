import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "../src/main/agent/runtime/agent-runtime";
import { spawnSubAgent, spawnSubAgentsParallel } from "../src/main/agent/subagent/spawn-subagent";
import { buildSubAgentSystemPrompt } from "../src/main/agent/subagent/sub-system-prompt";
import { SUB_AGENT_TOOLS } from "../src/main/agent/subagent/workspace-tools";
import { createTaskTool } from "../src/main/agent/tools/core/task";
import { ToolRegistry } from "../src/main/agent/tools/tool-registry";
import { submitCommandsTool } from "../src/main/agent/tools/core/submit-commands";
import type { AgentModelContentBlock, AgentModelGateway } from "../src/main/agent/gateway/types";
import { createStarterPresentation } from "../src/shared/presentation";
import { writeWorkspaceText } from "../src/main/agent/subagent/workspace-file-ops";

function createSequenceGateway(responses: AgentModelContentBlock[]): AgentModelGateway {
  let index = 0;
  return {
    async generateText() {
      const value = responses[index++];
      if (value === undefined) throw new Error("Unexpected gateway call");
      return {
        provider: "anthropic",
        model: "test-model",
        content: [value],
      };
    },
    async *generateTextStream() {
      const value = responses[index++];
      if (value === undefined) throw new Error("Unexpected gateway call");
      if (value.type === "text") yield { type: "text_delta" as const, text: value.text };
      yield { type: "complete" as const, content: [value] };
    },
  };
}

function modelToolCall(toolName: string, args: Record<string, unknown> = {}) {
  return {
    type: "tool_use" as const,
    id: crypto.randomUUID(),
    name: toolName,
    input: args,
  };
}

function modelMessage(content: string) {
  return { type: "text" as const, text: content };
}

describe("Task sub-agent routing", () => {
  it("returns only the final conclusion and discards sub-agent transcript", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-subagent-"));
    const gateway = createSequenceGateway([
      modelToolCall("write_file", { path: "brief.md", content: "# Brief\nAudience: engineers" }),
      modelMessage("**Created** brief.md with audience and purpose."),
    ]);

    const conclusion = await spawnSubAgent({
      description: "Draft brief.md for an AI agent talk",
      workspaceRoot,
      gateway,
      requestToolApproval: async () => true,
    });

    expect(conclusion).toBe("**Created** brief.md with audience and purpose.");
    expect(await readFile(join(workspaceRoot, "brief.md"), "utf8")).toContain("Audience: engineers");
  });

  it("returns malformed JSON-looking text directly instead of parsing the removed protocol", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-subagent-"));
    const raw = '{"type":"tool.call","data":';
    const gateway = createSequenceGateway([
      modelMessage(raw),
    ]);

    const conclusion = await spawnSubAgent({
      description: "Draft brief.md",
      workspaceRoot,
      gateway,
      requestToolApproval: async () => true,
    });

    expect(conclusion).toBe(raw);
  });

  it("documents native tools and direct text conclusions in the sub-agent prompt", () => {
    const prompt = buildSubAgentSystemPrompt(SUB_AGENT_TOOLS);

    expect(prompt).toContain("provider's native tool interface");
    expect(prompt).toContain("directly as text");
    expect(prompt).not.toContain("AgentTextEnvelope");
  });

  it("creates parent directories when writing workspace files", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-subagent-"));
    const gateway = createSequenceGateway([
      modelToolCall("write_file", {
        path: "slides/layout-plan.json",
        content: "{\"slides\":[]}\n",
      }),
      modelMessage("Wrote slides/layout-plan.json."),
    ]);

    const conclusion = await spawnSubAgent({
      description: "Write a layout plan",
      workspaceRoot,
      gateway,
      requestToolApproval: async () => true,
    });

    expect(conclusion).toBe("Wrote slides/layout-plan.json.");
    expect(await readFile(join(workspaceRoot, "slides", "layout-plan.json"), "utf8"))
      .toBe("{\"slides\":[]}\n");
  });

  it("writes workspace files through a verified temp file and cleans it up", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-subagent-"));

    await writeWorkspaceText(workspaceRoot, "slides/storyboard.json", "{\"slides\":[]}\n");

    expect(await readFile(join(workspaceRoot, "slides", "storyboard.json"), "utf8"))
      .toBe("{\"slides\":[]}\n");
    expect((await readdir(join(workspaceRoot, "slides"))).filter((name) => name.endsWith(".tmp")))
      .toEqual([]);
  });

  it("supports idempotent ensure_dir in sub-agent tools", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-subagent-"));
    const gateway = createSequenceGateway([
      modelToolCall("ensure_dir", { path: "slides" }),
      modelToolCall("ensure_dir", { path: "slides" }),
      modelMessage("Ensured slides directory."),
    ]);

    const conclusion = await spawnSubAgent({
      description: "Ensure slides directory exists",
      workspaceRoot,
      gateway,
      requestToolApproval: async () => true,
    });

    expect(conclusion).toBe("Ensured slides directory.");
    expect((await stat(join(workspaceRoot, "slides"))).isDirectory()).toBe(true);
  });

  it("routes simple mkdir -p bash calls through workspace file ops", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "ppt-subagent-"));
    const gateway = createSequenceGateway([
      modelToolCall("bash", { command: "mkdir -p slides" }),
      modelToolCall("write_file", {
        path: "slides/data.json",
        content: "{\"ok\":true}\n",
      }),
      modelMessage("Wrote slides/data.json."),
    ]);

    const conclusion = await spawnSubAgent({
      description: "Create slides directory, then write JSON",
      workspaceRoot,
      gateway,
      requestToolApproval: async () => true,
    });

    expect(conclusion).toBe("Wrote slides/data.json.");
    expect(await readFile(join(workspaceRoot, "slides", "data.json"), "utf8"))
      .toBe("{\"ok\":true}\n");
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
            content: [modelMessage("Brief done.")],
          };
        }
        return {
          provider: "anthropic",
          model: "test-model",
          content: [modelMessage("Outline done.")],
        };
      },
      async *generateTextStream() {
        yield { type: "complete" as const, content: [] };
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
    expect(result.type).toBe("command_proposal");
    const secondPrompt = JSON.parse(prompts[1]!);
    expect(secondPrompt.transcript[0]).toEqual({ role: "user", content: "Create an agent PPT" });
    expect(secondPrompt.transcript[1]).toMatchObject({
      role: "tool",
      toolName: "Task",
      result: {
        conclusion: "Sub-agent finished brief.md.",
        subtaskCount: 1,
      },
    });
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
