import type { AgentModelSelection, AgentModelSettings, AgentProvider } from "@shared/agent";
import type { AgentGatewayConfig } from "@shared/agent-gateway-config";
import { resolveAgentGatewayConfig } from "@shared/agent-gateway-config";
import { anthropicDriver } from "./anthropic";
import { resolveAgentModelConfig, type DriverResolvedConfig } from "./config";
import type { AgentProviderDriver } from "./driver";
import { openaiDriver } from "./openai";
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
} from "./types";
import { createModuleLogger } from "../logger";
import { textFromContentBlocks } from "./content-blocks";
import type { ModelUsageRecord } from "../../token-usage-store";

const logger = createModuleLogger("gateway");

const DRIVERS = {
  openai: openaiDriver,
  anthropic: anthropicDriver,
} satisfies Record<AgentProvider, AgentProviderDriver>;

function resolveDriver(provider: AgentProvider): AgentProviderDriver {
  const driver = DRIVERS[provider];
  if (!Object.hasOwn(DRIVERS, provider) || !driver) {
    throw new AgentGatewayError(
      `No provider driver registered for ${provider}.`,
      "configuration",
      provider,
    );
  }
  return driver;
}

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
  ): DriverResolvedConfig {
    return resolveAgentModelConfig(selection, this.runtimeSettings, process.env, this.gatewayConfig);
  }

  /** Route one prepared provider-neutral request through a provider driver. */
  async generateText(
    request: AgentModelRequest,
    selection?: Pick<AgentModelSettings, "provider" | "model">,
  ): Promise<AgentModelResponse> {
    const gatewayRequestId = crypto.randomUUID();
    const startedAt = Date.now();
    let config: DriverResolvedConfig | undefined;

    try {
      config = this.resolveConfig(selection);
      const driver = resolveDriver(config.provider);
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

      const response = await driver.generate(config, preparedRequest);
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
    let config: DriverResolvedConfig | undefined;

    try {
      config = this.resolveConfig(selection);
      const driver = resolveDriver(config.provider);
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
      const generator = driver.generateStream(config, preparedRequest);

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

// -- Types --
export type {
  AgentModelGateway,
  AgentModelRequest,
  AgentModelResponse,
  AgentModelStreamChunk,
  AgentResponseContract,
  // 补齐常用类型，避免外部 deep-import
  AgentModelContentBlock,
  AgentModelMessage,
  AgentModelTextBlock,
  AgentModelThinkingBlock,
  AgentModelImageBlock,
  AgentModelToolUseBlock,
  AgentModelToolResultBlock,
  AgentToolSchema,
  PreparedAgentModelRequest,
  ResolvedAgentModelConfig,
  StopReason,
} from "./types";

// -- Errors (Gateway 标准错误与恢复分类) --
export {
  AgentGatewayError,
  isOutputTruncated,
  classifyGatewayRecovery,
  isAbortError,
  formatRecoverableAgentError,
} from "./errors";
export type { AgentGatewayErrorCode, GatewayRecoveryKind } from "./errors";

// -- Content blocks --
export {
  textFromContentBlocks,
  toolUseBlocksFromContent,
  thinkingFromContentBlocks,
  toolResultBlocksFromContent,
  textBlock,
} from "./content-blocks";

// -- Message pairing --
export { ensureToolResultPairing, withEphemeralPrompt } from "./message-pairing";

// -- Response contract --
export { buildContentBlockResponseGuidance } from "./response-contract";

// -- Config (仅 Runtime 需要的 fallback 选择) --
export { resolveFallbackModelSelection } from "./config";

// -- Retry --
export { backoffBeforeRetry, computeBackoffDelayMs, sleepWithAbort } from "./withRetry";
export type { RetryOptions } from "./withRetry";

// -- Model calls --
export {
  callLLM,
  callTool,
  ModelOutputError,
  type MarkdownModelRequest,
  type ModelOutputErrorCode,
  type ToolModelRequest,
  type ToolModelTurn,
} from "./model-calls";
