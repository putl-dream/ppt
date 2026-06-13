import { z } from "zod";

export const agentProviderSchema = z.enum(["openai", "anthropic"]);

export const agentModelSettingsSchema = z.object({
  provider: agentProviderSchema,
  model: z.string().trim().min(1),
  apiKey: z.string().trim().min(1).optional(),
});

export type AgentProvider = z.infer<typeof agentProviderSchema>;
export type AgentModelSettings = z.infer<typeof agentModelSettingsSchema>;
export type AgentModelSelection = Omit<AgentModelSettings, "apiKey">;
