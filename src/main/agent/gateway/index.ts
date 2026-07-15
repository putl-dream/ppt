import type { AgentModelSelection, AgentModelSettings, AgentProvider } from "@shared/agent";
import type { AgentGatewayConfig } from "@shared/agent-gateway-config";
import { resolveAgentGatewayConfig } from "@shared/agent-gateway-config";
import { generateWithAnthropic, generateStreamWithAnthropic } from "./anthropic";
import { resolveAgentModelConfig } from "./config";
import { generateWithOpenAI, generateStreamWithOpenAI } from "./openai";
import type {
  AgentModelGateway,
  AgentModelRequest,
  AgentModelResponse,
  AgentModelStreamChunk,
} from "./types";
import { createModuleLogger } from "../logger";
import { textFromContentBlocks } from "./content-blocks";
import type { ModelUsageRecord } from "../../token-usage-store";

const logger = createModuleLogger("gateway");

export class AgentGateway implements AgentModelGateway {
  private readonly runtimeSettings: Partial<Record<AgentProvider, AgentModelSettings>> = {};
  private gatewayConfig: AgentGatewayConfig = resolveAgentGatewayConfig();
  private usageRecorder?: (record: ModelUsageRecord) => Promise<void>;

  setUsageRecorder(recorder: (record: ModelUsageRecord) => Promise<void>): void {
    this.usageRecorder = recorder;
  }

  private async recordUsage(record: ModelUsageRecord): Promise<void> {
    try {
      await this.usageRecorder?.(record);
    } catch (error) {
      logger.error("model.usage.persist-failed", {
        provider: record.provider,
        model: record.model,
        error,
      });
    }
  }

  configure(
    settings: AgentModelSettings,
    gatewayConfig?: AgentGatewayConfig,
  ): AgentModelSelection {
    this.runtimeSettings[settings.provider] = { ...settings };
    if (gatewayConfig) {
      this.gatewayConfig = resolveAgentGatewayConfig(gatewayConfig);
      if (gatewayConfig.fallbackModel) {
        const fallback = gatewayConfig.fallbackModel;
        this.runtimeSettings[fallback.provider] = { ...fallback };
      }
    }
    return { provider: settings.provider, model: settings.model };
  }

  applyGatewayConfig(gatewayConfig: AgentGatewayConfig): void {
    this.gatewayConfig = resolveAgentGatewayConfig(gatewayConfig);
    if (gatewayConfig.fallbackModel) {
      const fallback = gatewayConfig.fallbackModel;
      this.runtimeSettings[fallback.provider] = { ...fallback };
    }
  }

  getGatewayConfig(): AgentGatewayConfig {
    return this.gatewayConfig;
  }

  private resolveConfig(
    selection?: Pick<AgentModelSettings, "provider" | "model">,
  ) {
    return resolveAgentModelConfig(selection, this.runtimeSettings, process.env, this.gatewayConfig);
  }

  async generateText(
    request: AgentModelRequest,
    selection?: Pick<AgentModelSettings, "provider" | "model">,
  ): Promise<AgentModelResponse> {
    const gatewayRequestId = crypto.randomUUID();
    const startedAt = Date.now();

    try {
      const config = this.resolveConfig(selection);
      logger.info("model.request.started", {
        gatewayRequestId,
        provider: config.provider,
        model: config.model,
        apiMode: config.openaiApiMode,
        promptLength: request.prompt.length,
        systemPromptLength: request.systemPrompt?.length ?? 0,
        timeoutMs: config.timeoutMs,
        maxOutputTokens: config.maxOutputTokens,
      });

      const response = config.provider === "openai"
        ? await generateWithOpenAI(config, request)
        : await generateWithAnthropic(config, request);

      if (response.usage) {
        await this.recordUsage({
          ...response.usage,
          provider: response.provider,
          model: response.model,
        });
      }

      logger.info("model.request.completed", {
        gatewayRequestId,
        provider: response.provider,
        model: response.model,
        providerRequestId: response.requestId,
        stopReason: response.stopReason,
        responseLength: textFromContentBlocks(response.content).length,
        durationMs: Date.now() - startedAt,
      });
      return response;
    } catch (error) {
      logger.error("model.request.failed", {
        gatewayRequestId,
        provider: selection?.provider,
        model: selection?.model,
        durationMs: Date.now() - startedAt,
        error,
      });
      throw error;
    }
  }

  async *generateTextStream(
    request: AgentModelRequest,
    selection?: Pick<AgentModelSettings, "provider" | "model">,
  ): AsyncGenerator<AgentModelStreamChunk> {
    const gatewayRequestId = crypto.randomUUID();
    const startedAt = Date.now();

    try {
      const config = this.resolveConfig(selection);
      logger.info("model.stream.started", {
        gatewayRequestId,
        provider: config.provider,
        model: config.model,
        apiMode: config.openaiApiMode,
        promptLength: request.prompt.length,
        systemPromptLength: request.systemPrompt?.length ?? 0,
        timeoutMs: config.timeoutMs,
        maxOutputTokens: config.maxOutputTokens,
      });

      let totalLength = 0;
      const generator = config.provider === "openai"
        ? generateStreamWithOpenAI(config, request)
        : generateStreamWithAnthropic(config, request);

      for await (const chunk of generator) {
        if (chunk.type === "text_delta") {
          totalLength += chunk.text.length;
        } else if (chunk.type === "complete" && chunk.usage) {
          await this.recordUsage({
            ...chunk.usage,
            provider: config.provider,
            model: config.model,
          });
        }
        yield chunk;
      }

      logger.info("model.stream.completed", {
        gatewayRequestId,
        provider: config.provider,
        model: config.model,
        totalLength,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      logger.error("model.stream.failed", {
        gatewayRequestId,
        provider: selection?.provider,
        model: selection?.model,
        durationMs: Date.now() - startedAt,
        error,
      });
      throw error;
    }
  }
}

export type {
  AgentModelGateway,
  AgentModelRequest,
  AgentModelResponse,
  AgentModelStreamChunk,
  AgentResponseContract,
  AgentModelOutputFormat,
  AgentJsonSchemaOutputFormat,
} from "./types";
export { AgentGatewayError } from "./errors";
export {
  callLLM,
  callLLMJson,
  callTool,
  ModelOutputError,
  type JsonModelCallOptions,
  type MarkdownModelRequest,
  type ModelOutputErrorCode,
  type ToolModelRequest,
  type ToolModelTurn,
} from "./model-calls";
