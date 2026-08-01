import type { DriverResolvedConfig } from "./config";
import type { AgentProviderDriver } from "./driver";
import { openAIChatDriver } from "./openai-chat";
import {
  createOpenAIClient,
  type OpenAIModeDriver,
} from "./openai-common";
import { openAIResponsesDriver } from "./openai-responses";
import type {
  AgentModelResponse,
  AgentModelStreamChunk,
  PreparedAgentModelRequest,
} from "./types";

type OpenAIApiMode = NonNullable<DriverResolvedConfig["openaiApiMode"]>;

const OPENAI_MODE_DRIVERS = {
  responses: openAIResponsesDriver,
  "chat-completions": openAIChatDriver,
} satisfies Record<OpenAIApiMode, OpenAIModeDriver>;

function modeDriver(config: DriverResolvedConfig): OpenAIModeDriver {
  return OPENAI_MODE_DRIVERS[config.openaiApiMode ?? "responses"];
}

/** Execute one non-streaming OpenAI driver attempt. */
export async function generateWithOpenAI(
  config: DriverResolvedConfig,
  request: PreparedAgentModelRequest,
): Promise<AgentModelResponse> {
  return modeDriver(config).generate(createOpenAIClient(config), config, request);
}

/** Execute one native streaming OpenAI driver attempt. */
export async function* generateStreamWithOpenAI(
  config: DriverResolvedConfig,
  request: PreparedAgentModelRequest,
): AsyncGenerator<AgentModelStreamChunk> {
  yield* modeDriver(config).generateStream(createOpenAIClient(config), config, request);
}

export const openaiDriver = {
  generate: generateWithOpenAI,
  generateStream: generateStreamWithOpenAI,
} satisfies AgentProviderDriver;
