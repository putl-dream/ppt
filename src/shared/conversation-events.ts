import { z } from "zod";

export const conversationEventKindSchema = z.enum([
  "user_message",
  "assistant_started",
  "text_chunk",
  "reasoning_chunk",
  "model_response",
  "stage_started",
  "workflow_progress",
  "tool_call",
  "tool_started",
  "tool_result",
  "tool_finished",
  "tool_failed",
  "approval_requested",
  "approval_resolved",
  "task_graph_updated",
  "artifact_written",
  "assistant_completed",
  "run_started",
  "run_completed",
  "run_failed",
  "run_interrupted",
]);

export const conversationEventVisibilitySchema = z.enum([
  "user_visible",
  "model_only",
  "internal",
  "redacted",
]);

export const conversationEventSchema = z.object({
  id: z.number().int().positive(),
  sessionId: z.string(),
  runId: z.string().optional(),
  threadId: z.string().optional(),
  sequence: z.number().int().nonnegative(),
  kind: conversationEventKindSchema,
  visibility: conversationEventVisibilitySchema,
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

export type ConversationEventKind = z.infer<typeof conversationEventKindSchema>;
export type ConversationEventVisibility = z.infer<typeof conversationEventVisibilitySchema>;
export type ConversationEvent = z.infer<typeof conversationEventSchema>;

export interface AppendConversationEventInput {
  sessionId?: string;
  runId?: string;
  threadId?: string;
  kind: ConversationEventKind;
  visibility?: ConversationEventVisibility;
  payload?: Record<string, unknown>;
  createdAt?: string;
}

export interface ConversationEventPage {
  events: ConversationEvent[];
  nextCursor?: number;
}
