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

export function parseAgentJsonResponse(text: string): unknown {
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    const closingTokens: string[] = [];
    let inString = false;
    let escaped = false;

    for (let index = start; index < text.length; index += 1) {
      const token = text[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (token === "\\") {
          escaped = true;
        } else if (token === '"') {
          inString = false;
        }
        continue;
      }

      if (token === '"') {
        inString = true;
      } else if (token === "{") {
        closingTokens.push("}");
      } else if (token === "[") {
        closingTokens.push("]");
      } else if (token === "}" || token === "]") {
        if (closingTokens.pop() !== token) break;

        if (closingTokens.length === 0) {
          try {
            return JSON.parse(text.slice(start, index + 1));
          } catch {
            break;
          }
        }
      }
    }
  }

  throw new Error("Agent Runtime expected one complete JSON object.");
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
      requiredOutcome: options.requiredOutcome,
    });
    const transcript: Array<Record<string, unknown>> = [
      { role: "user", content: options.request },
    ];
    const maxSteps = options.maxSteps ?? 12;

    for (let step = 0; step < maxSteps; step += 1) {
      // 判断是否应该使用流式：仅在可能返回message且提供了回调时使用
      const shouldUseStream = options.onStreamChunk !== undefined;

      let responseText: string;

      if (shouldUseStream) {
        // 流式模式：逐chunk接收并实时回调
        let accumulatedText = "";
        for await (const chunk of this.gateway.generateTextStream(
          {
            systemPrompt,
            prompt: JSON.stringify({
              request: options.request,
              conversation: options.messageHistory ?? [],
              transcript,
            }),
          },
          options.model,
        )) {
          if (chunk.type === "content") {
            accumulatedText += chunk.text;
            // 只在返回纯文本消息时才实时推送，工具调用需要完整JSON
            // 这里先累积，后续根据解析结果决定是否已经推送过
            options.onStreamChunk?.(chunk.text);
          }
        }
        responseText = accumulatedText;
      } else {
        // 非流式模式：等待完整响应
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
        responseText = response.text;
      }

      let parsed: unknown;
      try {
        parsed = parseAgentJsonResponse(responseText);
      } catch (error) {
        transcript.push({
          role: "assistant",
          raw: responseText.slice(0, 2_000),
          error: error instanceof Error
            ? `${error.message} Return exactly one complete JSON object.`
            : "Invalid JSON response. Return exactly one complete JSON object.",
        });
        continue;
      }

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
        let normalized: AgentRuntimeResult;
        try {
          normalized = RuntimeNormalizer.normalize(parsed);
        } catch (error) {
          transcript.push({
            role: "assistant",
            response: parsed,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }

        if (normalized.type === "message" && options.requiredOutcome === "command_proposal") {
          transcript.push({
            role: "assistant",
            response: normalized,
            error:
              "This is an unresolved presentation action. Do not narrate future work. "
              + "Call AskUser if information is still missing, otherwise continue tools and finish with SubmitCommands.",
          });
          continue;
        }

        return normalized;
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

    if (options.requiredOutcome === "command_proposal") {
      throw new Error(
        "Agent reached the tool-step limit before resolving the presentation action. "
        + "The conversation remains active and can be continued.",
      );
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
