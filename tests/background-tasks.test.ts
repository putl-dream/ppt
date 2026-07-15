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
  AgentModelToolUseBlock,
} from "../src/main/agent/gateway/types";
import { ToolRegistry } from "../src/main/agent/tools/tool-registry";
import type { ToolDefinition } from "../src/main/agent/tools/tool-definition";
import { executeExtraToolTool } from "../src/main/agent/tools/core/execute-extra-tool";
import { searchExtraToolsTool } from "../src/main/agent/tools/core/search-extra-tools";
import { exportPptxTool } from "../src/main/agent/tools/deferred/export-pptx";
import { previewSlideTool } from "../src/main/agent/tools/deferred/preview-slide";
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

const textContent = (text: string) => [{ type: "text" as const, text }];

function createNativeGateway(
  handler: (request: AgentModelRequest, index: number) => AgentModelResponse | Promise<AgentModelResponse>,
): AgentModelGateway & { requests: AgentModelRequest[] } {
  let index = 0;
  const requests: AgentModelRequest[] = [];
  return {
    requests,
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
      yield { type: "complete" as const, content: response.content };
    },
  };
}

function modelToolCall(
  id: string,
  name: string,
  args: Record<string, unknown> = {},
): AgentModelToolUseBlock {
  return { type: "tool_use", id, name, input: args };
}

describe("background task manager", () => {
  it("collects completed and failed task notifications", async () => {
    const manager = new BackgroundTaskManager();
    manager.start({
      toolName: "PreviewSlide",
      label: "PreviewSlide: success",
      run: async () => ({ ok: true }),
    });
    manager.start({
      toolName: "PreviewSlide",
      label: "PreviewSlide: failure",
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

describe("AgentRuntime background tool path", () => {
  it("exposes run_in_background on slow core/deferred execution schemas", () => {
    const executeSpec = toToolSchema(executeExtraToolTool);
    expect(executeSpec.inputSchema.properties as Record<string, unknown>)
      .toHaveProperty("run_in_background");

    const exportSpec = toToolSchema(exportPptxTool);
    expect(exportSpec.inputSchema.properties as Record<string, unknown>)
      .toHaveProperty("run_in_background");

    const previewSpec = toToolSchema(previewSlideTool);
    expect(previewSpec.inputSchema.properties as Record<string, unknown>)
      .toHaveProperty("run_in_background");
  });

  it("backgrounds ExecuteExtraTool when it runs ExportPptx", async () => {
    const exportWork = deferred<{ success: boolean; filePath: string }>();
    const events: string[] = [];
    let exportResolved = false;

    const exportSchema = z.object({
      format: z.enum(["pptx", "html", "pdf"]).default("pptx"),
      run_in_background: z.boolean().optional(),
    });
    const mockExportTool: ToolDefinition<typeof exportSchema, { success: boolean; filePath: string }> = {
      name: "ExportPptx",
      description: "Mock slow export",
      category: "deferred",
      loadPolicy: "deferred",
      inputSchema: exportSchema,
      risk: "medium",
      execute: async () => {
        events.push("export-start");
        const result = await exportWork.promise;
        exportResolved = true;
        events.push("export-finish");
        return result;
      },
    };

    const gateway = createNativeGateway((_request, index) => {
      if (index === 0) {
        return {
          provider: "anthropic",
          model: "test-model",
          content: [modelToolCall("call-search", "SearchExtraTools", { query: "ExportPptx" })],
        };
      }
      if (index === 1) {
        return {
          provider: "anthropic",
          model: "test-model",
          content: [
            modelToolCall("call-export", "ExecuteExtraTool", {
              toolName: "ExportPptx",
              toolArgs: { format: "pptx", run_in_background: true },
            }),
          ],
        };
      }
      if (index === 2) {
        events.push("third-model-call");
        expect(exportResolved).toBe(false);
        setTimeout(() => exportWork.resolve({ success: true, filePath: "deck.pptx" }), 0);
        return {
          provider: "anthropic",
          model: "test-model",
          content: textContent("Trying to finish before export result."),
        };
      }
      return {
        provider: "anthropic",
        model: "test-model",
        content: textContent("Finished after export notification."),
      };
    });

    const registry = new ToolRegistry();
    registry.register(searchExtraToolsTool);
    registry.register(executeExtraToolTool);
    registry.register(mockExportTool);
    const runtime = new AgentRuntime(registry, gateway);

    const result = await runtime.run({
      threadId: "background-export-thread",
      request: "Export deck",
      presentationSnapshot: createStarterPresentation(),
      selectedElementIds: [],
    });

    expect(result.type).toBe("message");
    if (result.type === "message") {
      expect(result.content).toContain("Finished after export");
    }
    expect(events).toEqual(["export-start", "third-model-call", "export-finish"]);
    expect(gateway.requests).toHaveLength(4);

    const thirdMessages = gateway.requests[2]!.messages!;
    const exportPlaceholder = thirdMessages.flatMap((message) => message.content)
      .find((block) => block.type === "tool_result" && block.toolUseId === "call-export");
    expect(exportPlaceholder).toMatchObject({ type: "tool_result", toolUseId: "call-export" });

    const fourthMessages = gateway.requests[3]!.messages!;
    const notificationTurn = fourthMessages.find((message) =>
      message.role === "user" && message.content.some((block) =>
        block.type === "text" && block.text.includes("<task_notification>")));
    const notificationText = notificationTurn?.content
      .filter((block) => block.type === "text").map((block) => block.text).join("\n") ?? "";
    expect(notificationText).toContain("<tool>ExecuteExtraTool</tool>");
    expect(notificationText).toContain("ExportPptx: pptx");
    expect(notificationText).toContain("deck.pptx");
  });
});
