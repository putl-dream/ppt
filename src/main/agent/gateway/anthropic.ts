import Anthropic from "@anthropic-ai/sdk";
import { AgentGatewayError, normalizeProviderError } from "./errors";
import type { AgentModelRequest, AgentModelResponse, ResolvedAgentModelConfig } from "./types";

export async function generateWithAnthropic(
  config: ResolvedAgentModelConfig,
  request: AgentModelRequest,
): Promise<AgentModelResponse> {
  const client = new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: config.timeoutMs,
    maxRetries: 2,
  });

  try {
    const response = await client.messages.create({
      model: config.model,
      max_tokens: config.maxOutputTokens,
      system: request.systemPrompt,
      messages: [{ role: "user", content: request.prompt }],
    });
    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (!text) {
      throw new AgentGatewayError("Anthropic returned an empty response.", "empty-response", "anthropic");
    }
    return {
      provider: "anthropic",
      model: config.model,
      text,
      requestId: response._request_id ?? undefined,
      stopReason: response.stop_reason ?? undefined,
    };
  } catch (error) {
    throw normalizeProviderError("anthropic", error);
  }
}
