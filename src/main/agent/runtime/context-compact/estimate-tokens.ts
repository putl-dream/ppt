import type { ModelPromptPayload } from "../turns/model-call-recovery";
import { CHARS_PER_TOKEN_ESTIMATE } from "./config";

/**
 * Cheap token estimate from serialized prompt size (no API / tokenizer).
 */
export function estimatePromptTokens(
  systemPrompt: string,
  payload: ModelPromptPayload,
): number {
  const serialized = systemPrompt + JSON.stringify(payload);
  return Math.ceil(serialized.length / CHARS_PER_TOKEN_ESTIMATE);
}
