import { z } from "zod";

export const agentQuestionVariantSchema = z.enum(["markdown", "choices", "cards"]);
export const agentQuestionSelectionModeSchema = z.enum(["single", "multiple"]);

export const agentQuestionOptionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).optional(),
  detail: z.string().trim().max(500).optional(),
  value: z.string().trim().min(1).max(500).optional(),
  badge: z.string().trim().max(24).optional(),
});

export const agentQuestionResolvedSchema = z.object({
  optionIds: z.array(z.string()).max(8),
  value: z.string().trim().max(1_000),
  label: z.string().trim().max(240).optional(),
  resolvedAt: z.string().optional(),
});

export const agentQuestionSchema = z.object({
  variant: agentQuestionVariantSchema.default("markdown"),
  selectionMode: agentQuestionSelectionModeSchema.default("single"),
  options: z.array(agentQuestionOptionSchema).max(8).optional(),
  allowFreeText: z.boolean().optional(),
  submitLabel: z.string().trim().max(24).optional(),
  placeholder: z.string().trim().max(120).optional(),
  resolved: agentQuestionResolvedSchema.optional(),
}).superRefine((question, ctx) => {
  if (question.variant === "markdown") return;
  if (!question.options || question.options.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["options"],
      message: "choices/cards questions must include at least one option.",
    });
  }
});

export type AgentQuestionVariant = z.infer<typeof agentQuestionVariantSchema>;
export type AgentQuestionSelectionMode = z.infer<typeof agentQuestionSelectionModeSchema>;
export type AgentQuestionOption = z.infer<typeof agentQuestionOptionSchema>;
export type AgentQuestionResolved = z.infer<typeof agentQuestionResolvedSchema>;
export type AgentQuestion = z.infer<typeof agentQuestionSchema>;
