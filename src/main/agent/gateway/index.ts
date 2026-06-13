import type { AgentModelSelection, AgentModelSettings, AgentProvider } from "@shared/agent";
import { generateWithAnthropic } from "./anthropic";
import { resolveAgentModelConfig } from "./config";
import { generateWithOpenAI } from "./openai";
import type { AgentModelGateway, AgentModelRequest, AgentModelResponse } from "./types";

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
    const config = resolveAgentModelConfig(selection, this.runtimeSettings);
    return config.provider === "openai"
      ? generateWithOpenAI(config, request)
      : generateWithAnthropic(config, request);
  }
}

export type { AgentModelGateway, AgentModelRequest, AgentModelResponse } from "./types";
export { AgentGatewayError } from "./errors";
