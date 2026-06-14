import type { AgentModelSelection, AgentModelSettings, AgentProvider } from "@shared/agent";
import { generateWithAnthropic } from "./anthropic";
import { resolveAgentModelConfig } from "./config";
import { generateWithOpenAI } from "./openai";
import type { AgentModelGateway, AgentModelRequest, AgentModelResponse } from "./types";
import { agentLogger } from "../logger";

export class AgentGateway implements AgentModelGateway {
  private readonly runtimeSettings: Partial<Record<AgentProvider, AgentModelSettings>> = {};

  configure(settings: AgentModelSettings): AgentModelSelection {
    this.runtimeSettings[settings.provider] = { ...settings };
    return { provider: settings.provider, model: settings.model };
  }

  async generateText(
    request: AgentModelRequest,
    selection?: Pick<AgentModelSettings, "provider" | "model">,
  ): Promise<AgentModelResponse> {
    const gatewayRequestId = crypto.randomUUID();
    const startedAt = Date.now();

    try {
      const config = resolveAgentModelConfig(selection, this.runtimeSettings);
      agentLogger.info("model.request.started", {
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

      agentLogger.info("model.request.completed", {
        gatewayRequestId,
        provider: response.provider,
        model: response.model,
        providerRequestId: response.requestId,
        stopReason: response.stopReason,
        responseLength: response.text.length,
        durationMs: Date.now() - startedAt,
      });
      return response;
    } catch (error) {
      agentLogger.error("model.request.failed", {
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

export type { AgentModelGateway, AgentModelRequest, AgentModelResponse } from "./types";
export { AgentGatewayError } from "./errors";
