import type { AgentModelGateway } from "../gateway";
import type { ToolContext, ToolDiscoverySession } from "../tools/tool-definition";
import { ToolRegistry } from "../tools/tool-registry";
import { RuntimeNormalizer } from "./runtime-normalizer";
import { SystemPromptBuilder } from "./system-prompt";
import type { AgentRuntimeOptions, AgentRuntimeResult } from "./runtime-types";

type ToolCall = {
  type: "tool_call";
  toolName: string;
  args: unknown;
};

function parseJsonResponse(text: string): unknown {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Agent Runtime expected a JSON object.");
  return JSON.parse(stripped.slice(start, end + 1));
}

function isToolCall(value: unknown): value is ToolCall {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.type === "tool_call" && typeof candidate.toolName === "string";
}

/**
 * 模型驱动的 Agent Runtime。模型只能直接调用 Core Tools；Deferred Tools 必须
 * 经 SearchExtraTools 发现，再由 ExecuteExtraTool 路由。
 */
export class AgentRuntime {
  private readonly discoverySessions = new Map<string, ToolDiscoverySession>();

  constructor(
    private readonly registry: ToolRegistry,
    private readonly gateway: AgentModelGateway,
  ) {}

  async run(options: AgentRuntimeOptions): Promise<AgentRuntimeResult> {
    const discoverySession = this.discoverySessions.get(options.threadId) ?? {
      discoveredToolNames: new Set<string>(),
    };
    this.discoverySessions.set(options.threadId, discoverySession);

    const context: ToolContext = {
      presentation: structuredClone(options.presentationSnapshot),
      currentSlideId: options.currentSlideId,
      selectedElementIds: [...options.selectedElementIds],
      discoverySession,
      registry: this.registry,
      messageHistory: options.messageHistory ?? [],
    };
    const coreTools = this.registry.getCoreTools();
    const systemPrompt = SystemPromptBuilder.build({
      coreTools,
      currentSlideId: options.currentSlideId,
    });
    const transcript: Array<Record<string, unknown>> = [
      { role: "user", content: options.request },
    ];
    const maxSteps = options.maxSteps ?? 12;

    for (let step = 0; step < maxSteps; step += 1) {
      const response = await this.gateway.generateText(
        {
          systemPrompt,
          prompt: JSON.stringify({
            request: options.request,
            conversation: options.messageHistory ?? [],
            transcript,
          }),
        },
        options.model,
      );
      const parsed = parseJsonResponse(response.text);

      if (!isToolCall(parsed)) {
        if (
          parsed &&
          typeof parsed === "object" &&
          (parsed as { type?: unknown }).type === "command_proposal"
        ) {
          transcript.push({
            role: "tool",
            error: "Command proposals must be submitted through SubmitCommands.",
          });
          continue;
        }
        return RuntimeNormalizer.normalize(parsed);
      }

      const tool = this.registry.get(parsed.toolName);
      if (!tool || tool.category !== "core" || tool.loadPolicy !== "core") {
        transcript.push({
          role: "tool",
          toolName: parsed.toolName,
          error: "Only registered Core Tools can be called directly.",
        });
        continue;
      }

      const args = tool.inputSchema.safeParse(parsed.args ?? {});
      if (!args.success) {
        transcript.push({ role: "tool", toolName: tool.name, error: args.error.message });
        continue;
      }

      try {
        const result = await tool.execute(args.data, context);
        if (tool.name === "AskUser" || tool.name === "SubmitCommands") {
          return RuntimeNormalizer.normalize(result);
        }
        transcript.push({ role: "tool", toolName: tool.name, result });
      } catch (error) {
        transcript.push({
          role: "tool",
          toolName: tool.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      type: "message",
      content: "本次请求的工具调用步骤超过上限，请缩小修改范围后重试。",
    };
  }

  clearSession(threadId: string): void {
    this.discoverySessions.delete(threadId);
  }
}
