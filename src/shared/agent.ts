import { z } from "zod";

export const agentProviderSchema = z.enum(["openai", "anthropic"]);
export const agentExecutionStrategySchema = z.enum(["REQUEST_APPROVAL", "AUTO"]);

export const agentModelSettingsSchema = z.object({
  provider: agentProviderSchema,
  model: z.string().trim().min(1),
  apiKey: z.string().trim().min(1).optional(),
  baseURL: z.string().trim().url().optional(),
  openaiApiMode: z.enum(["responses", "chat-completions"]).optional(),
});

export type AgentProvider = z.infer<typeof agentProviderSchema>;
export type AgentExecutionStrategy = z.infer<typeof agentExecutionStrategySchema>;
export type AgentModelSettings = z.infer<typeof agentModelSettingsSchema>;
export type AgentModelSelection = Omit<AgentModelSettings, "apiKey">;
