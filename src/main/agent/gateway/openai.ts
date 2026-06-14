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
    // Keep provider failures visible to the Runtime instead of silently
    // multiplying the configured timeout inside the SDK.
    maxRetries: 0,
  });

  try {
    const mode = config.openaiApiMode ?? "responses";
    let text: string;
    let requestId: string | undefined;
    let stopReason: string | undefined;

    if (mode === "responses") {
      const response = await client.responses.create({
        model: config.model,
        instructions: request.systemPrompt,
        input: request.prompt,
        max_output_tokens: config.maxOutputTokens,
      });
      text = response.output_text.trim();
      requestId = response._request_id ?? undefined;
    } else {
      const response = await client.chat.completions.create({
        model: config.model,
        messages: [
          ...(request.systemPrompt
            ? [{ role: "system" as const, content: request.systemPrompt }]
            : []),
          { role: "user", content: request.prompt },
        ],
        max_tokens: config.maxOutputTokens,
      });
      text = (response.choices[0]?.message.content ?? "").trim();
      requestId = response._request_id ?? undefined;
      stopReason = response.choices[0]?.finish_reason ?? undefined;
    }

    if (!text) {
      throw new AgentGatewayError("OpenAI returned an empty response.", "empty-response", "openai");
    }
    return {
      provider: "openai",
      model: config.model,
      text,
      requestId,
      stopReason,
    };
  } catch (error) {
    throw normalizeProviderError("openai", error);
  }
}
