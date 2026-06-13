import OpenAI from "openai";
import { AgentGatewayError, normalizeProviderError } from "./errors";
import type { AgentModelRequest, AgentModelResponse, ResolvedAgentModelConfig } from "./types";

export async function generateWithOpenAI(
  config: ResolvedAgentModelConfig,
  request: AgentModelRequest,
): Promise<AgentModelResponse> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: config.timeoutMs,
    maxRetries: 2,
  });

  try {
    const response = await client.responses.create({
      model: config.model,
      instructions: request.systemPrompt,
      input: request.prompt,
      max_output_tokens: config.maxOutputTokens,
    });
    const text = response.output_text.trim();
    if (!text) {
      throw new AgentGatewayError("OpenAI returned an empty response.", "empty-response", "openai");
    }
    return {
      provider: "openai",
      model: config.model,
      text,
      requestId: response._request_id ?? undefined,
    };
  } catch (error) {
    throw normalizeProviderError("openai", error);
  }
}
