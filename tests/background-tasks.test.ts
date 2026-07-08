import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentRuntime } from "../src/main/agent/runtime/agent-runtime";
import {
  BackgroundTaskManager,
  formatBackgroundNotifications,
} from "../src/main/agent/runtime/background-task-manager";
import type {
  AgentModelGateway,
  AgentModelRequest,
  AgentModelResponse,
  AgentModelToolCall,
} from "../src/main/agent/gateway/types";
import { ToolRegistry } from "../src/main/agent/tools/tool-registry";
import type { ToolDefinition } from "../src/main/agent/tools/tool-definition";
import { taskTool } from "../src/main/agent/tools/core/task";
import { toToolSchema } from "../src/main/agent/tools/tool-schema";
import { createStarterPresentation } from "../src/shared/presentation";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function textEnvelope(content: string): string {
  return JSON.stringify({
    kind: "text",
    format: "markdown",
    type: "assistant.message",
    data: { content },
  });
}

function createNativeGateway(
  handler: (request: AgentModelRequest, index: number) => AgentModelResponse | Promise<AgentModelResponse>,
): AgentModelGateway & { requests: AgentModelRequest[] } {
  let index = 0;
  const requests: AgentModelRequest[] = [];
  return {
    requests,
    supportsNativeToolUse() {
      return true;
    },
    async generateText(request): Promise<AgentModelResponse> {
      requests.push(request);
      const response = await handler(request, index);
      index += 1;
      return response;
    },
    async *generateTextStream(request) {
      requests.push(request);
      const response = await handler(request, index);
      index += 1;
      if (response.text) {
        yield { type: "content" as const, text: response.text };
      }
      yield {
        type: "complete" as const,
        text: "",
        toolCalls: response.toolCalls,
      };
    },
  };
}

function modelToolCall(
  id: string,
  name: string,
  args: Record<string, unknown> = {},
): AgentModelToolCall {
  return { id, name, args };
}

describe("background task manager", () => {
  it("collects completed and failed task notifications", async () => {
    const manager = new BackgroundTaskManager();
    manager.start({
      toolName: "Task",
      label: "Task: success",
      run: async () => ({ ok: true }),
    });
    manager.start({
      toolName: "Task",
      label: "Task: failure",
      run: async () => {
        throw new Error("boom");
      },
    });

    const notifications = await manager.drain();

    expect(notifications).toHaveLength(2);
    expect(notifications.map((item) => item.status).sort()).toEqual(["completed", "failed"]);
    expect(formatBackgroundNotifications(notifications)).toContain("<task_notification>");
    expect(manager.hasRunning()).toBe(false);
    expect(manager.collect()).toEqual([]);
  });
});

describe("AgentRuntime background Task path", () => {
  const taskSchema = z.object({
    description: z.string().optional(),
    descriptions: z.array(z.string()).optional(),
    run_in_background: z.boolean().optional(),
  });

  it("exposes run_in_background on the Task tool schema", () => {
    const spec = toToolSchema(taskTool);
    const properties = spec.inputSchema.properties as Record<string, unknown>;
    expect(properties).toHaveProperty("run_in_background");
  });

  it("continues the model loop while a background Task is running, then injects notification", async () => {
    const work = deferred<string>();
    const events: string[] = [];
    let taskResolved = false;

    const backgroundTaskTool: ToolDefinition<typeof taskSchema, { conclusion: string }> = {
      name: "Task",
      description: "Test background task",
      category: "core",
      loadPolicy: "core",
      inputSchema: taskSchema,
      risk: "low",
      execute: async () => {
        events.push("task-start");
        const conclusion = await work.promise;
        taskResolved = true;
        events.push("task-finish");
        return { conclusion };
      },
    };

    const gateway = createNativeGateway((_request, index) => {
      if (index === 0) {
        return {
          provider: "anthropic",
          model: "test-model",
          text: "",
          toolCalls: [
            modelToolCall("call-task", "Task", {
              description: "Draft outline",
              run_in_background: true,
            }),
          ],
        };
      }
      if (index === 1) {
        events.push("second-model-call");
        expect(taskResolved).toBe(false);
        setTimeout(() => work.resolve("Outline done."), 0);
        return {
          provider: "anthropic",
          model: "test-model",
          text: textEnvelope("Trying to finish before background result."),
        };
      }
      return {
        provider: "anthropic",
        model: "test-model",
        text: textEnvelope("Finished after reading the background result."),
      };
    });

    const registry = new ToolRegistry();
    registry.register(backgroundTaskTool);
    const runtime = new AgentRuntime(registry, gateway);

    const result = await runtime.run({
      threadId: "background-task-thread",
      request: "Create a deck outline",
      presentationSnapshot: createStarterPresentation(),
      selectedElementIds: [],
    });

    expect(result.type).toBe("assistant.message");
    if (result.type === "assistant.message") {
      expect(result.data.content).toContain("Finished after");
    }
    expect(events).toEqual(["task-start", "second-model-call", "task-finish"]);
    expect(gateway.requests).toHaveLength(3);

    const secondMessages = gateway.requests[1]!.messages!;
    const placeholderTurn = secondMessages.find((message) => message.toolResults?.length);
    expect(placeholderTurn?.toolResults?.[0]?.toolCallId).toBe("call-task");
    expect(placeholderTurn?.toolResults?.[0]?.content).toContain("Background task bg_0001 started");

    const thirdMessages = gateway.requests[2]!.messages!;
    const notificationTurn = thirdMessages.find((message) =>
      message.role === "user" && message.content?.includes("<task_notification>"));
    expect(notificationTurn?.content).toContain("<task_id>bg_0001</task_id>");
    expect(notificationTurn?.content).toContain("Outline done.");
  });
});
