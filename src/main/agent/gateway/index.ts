import type { AgentModelSelection, AgentModelSettings, AgentProvider } from "@shared/agent";
import type { AgentGatewayConfig } from "@shared/agent-gateway-config";
import { resolveAgentGatewayConfig } from "@shared/agent-gateway-config";
import { generateWithAnthropic, generateStreamWithAnthropic } from "./anthropic";
import { resolveAgentModelConfig } from "./config";
import { generateWithOpenAI, generateStreamWithOpenAI } from "./openai";
import { AgentGatewayError, normalizeProviderError } from "./errors";
import {
  prepareAgentModelRequest,
  validateAgentModelResponse,
  validateStreamChunk,
} from "./protocol";
import type {
  AgentModelGateway,
  AgentModelRequest,
  AgentModelResponse,
  AgentModelStreamChunk,
  ResolvedAgentModelConfig,
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

  /**
   * 更新当前应用会话使用的 provider 配置，并返回后续请求应携带的模型选择。
   * API Key 等运行时设置只保存在主进程内存中。
   */
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
    return {
      ...(settings.configurationId ? { configurationId: settings.configurationId } : {}),
      provider: settings.provider,
      model: settings.model,
      ...(settings.supports1MContext ? { supports1MContext: true } : {}),
    };
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
    selection?: AgentModelSelection,
  ) {
    return resolveAgentModelConfig(selection, this.runtimeSettings, process.env, this.gatewayConfig);
  }

  /** Route one prepared provider-neutral request through a provider driver. */
  async generateText(
    request: AgentModelRequest,
    selection?: Pick<AgentModelSettings, "provider" | "model">,
  ): Promise<AgentModelResponse> {
    const gatewayRequestId = crypto.randomUUID();
    const startedAt = Date.now();
    let config: ResolvedAgentModelConfig | undefined;

    try {
      config = this.resolveConfig(selection);
      const preparedRequest = prepareAgentModelRequest(request, config);
      logger.info("model.request.started", {
        gatewayRequestId,
        provider: config.provider,
        model: config.model,
        apiMode: config.openaiApiMode,
        promptLength: request.prompt.length,
        systemPromptLength: preparedRequest.systemPrompt?.length ?? 0,
        timeoutMs: config.timeoutMs,
        maxOutputTokens: preparedRequest.maxOutputTokens,
      });

      const response = config.provider === "openai"
        ? await generateWithOpenAI(config, preparedRequest)
        : await generateWithAnthropic(config, preparedRequest);
      validateAgentModelResponse(response, config);

      if (response.usage) {
        await this.recordUsage({
          ...response.usage,
          ...(config.configurationId ? { configurationId: config.configurationId } : {}),
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
      const normalized = config
        ? normalizeProviderError(config.provider, error, request.signal)
        : error;
      logger.error("model.request.failed", {
        gatewayRequestId,
        provider: config?.provider ?? selection?.provider,
        model: config?.model ?? selection?.model,
        durationMs: Date.now() - startedAt,
        error: normalized,
      });
      throw normalized;
    }
  }

  /** generateText 的流式版本；向上层暴露统一 chunk 协议而非 provider 原生事件。 */
  async *generateTextStream(
    request: AgentModelRequest,
    selection?: Pick<AgentModelSettings, "provider" | "model">,
  ): AsyncGenerator<AgentModelStreamChunk> {
    const gatewayRequestId = crypto.randomUUID();
    const startedAt = Date.now();
    let config: ResolvedAgentModelConfig | undefined;

    try {
      config = this.resolveConfig(selection);
      const preparedRequest = prepareAgentModelRequest(request, config);
      logger.info("model.stream.started", {
        gatewayRequestId,
        provider: config.provider,
        model: config.model,
        apiMode: config.openaiApiMode,
        promptLength: request.prompt.length,
        systemPromptLength: preparedRequest.systemPrompt?.length ?? 0,
        timeoutMs: config.timeoutMs,
        maxOutputTokens: preparedRequest.maxOutputTokens,
      });

      let totalLength = 0;
      let completed = false;
      const generator = config.provider === "openai"
        ? generateStreamWithOpenAI(config, preparedRequest)
        : generateStreamWithAnthropic(config, preparedRequest);

      for await (const chunk of generator) {
        if (completed) {
          throw new AgentGatewayError(
            `${config.provider} stream emitted data after complete.`,
            "provider-error",
            config.provider,
          );
        }
        validateStreamChunk(chunk, config);
        if (chunk.type === "text_delta") {
          totalLength += chunk.text.length;
        } else if (chunk.type === "complete") {
          completed = true;
          if (chunk.usage) {
            await this.recordUsage({
              ...chunk.usage,
              ...(config.configurationId ? { configurationId: config.configurationId } : {}),
              provider: config.provider,
              model: config.model,
            });
          }
        }
        yield chunk;
      }
      if (!completed) {
        throw new AgentGatewayError(
          `${config.provider} stream ended without a complete event.`,
          "empty-response",
          config.provider,
        );
      }

      logger.info("model.stream.completed", {
        gatewayRequestId,
        provider: config.provider,
        model: config.model,
        totalLength,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      const normalized = config
        ? normalizeProviderError(config.provider, error, request.signal)
        : error;
      logger.error("model.stream.failed", {
        gatewayRequestId,
        provider: config?.provider ?? selection?.provider,
        model: config?.model ?? selection?.model,
        durationMs: Date.now() - startedAt,
        error: normalized,
      });
      throw normalized;
    }
  }
}

export type {
  AgentModelGateway,
  AgentModelRequest,
  AgentModelResponse,
  AgentModelStreamChunk,
  AgentResponseContract,
} from "./types";
export { AgentGatewayError } from "./errors";
export {
  callLLM,
  callTool,
  ModelOutputError,
  type MarkdownModelRequest,
  type ModelOutputErrorCode,
  type ToolModelRequest,
  type ToolModelTurn,
} from "./model-calls";
