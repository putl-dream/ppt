import { z } from "zod";
import { agentQuestionSchema } from "./agent-question";
import { agentTaskNodeSchema } from "./agent-task-graph";
import { presentationCommandSchema } from "./commands";
import { presentationSchema } from "./presentation";

/**
 * Stable semantic protocol shared by main and renderer processes.
 *
 * The main process describes what happened and whether interaction is blocking.
 * The renderer owns component selection, placement, timing, dedupe and UI state.
 */
export const displayCardCategorySchema = z.enum([
  "permission",
  "interaction",
  "review",
  "progress",
  "artifact",
  "notification",
  "environment",
]);

export const displayCardPrioritySchema = z.enum(["low", "normal", "high", "critical"]);

export const displayCardSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("tool"),
    toolName: z.string().trim().min(1),
    toolCallId: z.string().trim().min(1).optional(),
  }),
  z.object({
    kind: z.literal("agent"),
    agentName: z.string().trim().min(1).optional(),
  }),
  z.object({
    kind: z.literal("domain"),
    entityType: z.string().trim().min(1),
    entityId: z.string().trim().min(1),
    revision: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal("system"),
    subsystem: z.string().trim().min(1),
  }),
  z.object({
    kind: z.literal("frontend"),
    feature: z.string().trim().min(1),
  }),
]);

export const displayCardScopeSchema = z.object({
  sessionId: z.string().trim().min(1).optional(),
  runId: z.string().trim().min(1).optional(),
  threadId: z.string().trim().min(1).optional(),
  anchorMessageId: z.string().trim().min(1).optional(),
});

export const displayCardSemanticsSchema = z.object({
  blocking: z.boolean(),
  requiresResponse: z.boolean(),
  priority: displayCardPrioritySchema,
  expiresAt: z.string().optional(),
});

const commonDisplayEventShape = {
  protocolVersion: z.literal(1),
  eventId: z.string().trim().min(1),
  emittedAt: z.string().trim().min(1),
  source: displayCardSourceSchema,
  scope: displayCardScopeSchema,
  semantics: displayCardSemanticsSchema,
};

const permissionToolRequestedEventSchema = z.object({
  ...commonDisplayEventShape,
  kind: z.literal("permission.tool-requested"),
  category: z.literal("permission"),
  payload: z.object({
    approvalId: z.string().trim().min(1),
    toolName: z.string().trim().min(1),
    reason: z.string(),
    detail: z.string(),
  }),
});

const interactionQuestionRequestedEventSchema = z.object({
  ...commonDisplayEventShape,
  kind: z.literal("interaction.question-requested"),
  category: z.literal("interaction"),
  payload: z.object({
    message: z.string().trim().min(1),
    question: agentQuestionSchema.optional(),
  }),
});

const interactionLayoutRequiredEventSchema = z.object({
  ...commonDisplayEventShape,
  kind: z.literal("interaction.layout-required"),
  category: z.literal("interaction"),
  payload: z.object({
    presentationRevision: z.number().int().nonnegative(),
    slideCount: z.number().int().positive(),
  }),
});

export const agentApprovalDiffSchema = z.object({
  titleChanged: z.boolean(),
  oldTitle: z.string(),
  newTitle: z.string(),
  designSystemChanged: z.boolean(),
  slidesAddedCount: z.number().int().nonnegative(),
  slidesRemovedCount: z.number().int().nonnegative(),
  affectedSlideIds: z.array(z.string()),
  elementChanges: z.object({
    addedCount: z.number().int().nonnegative(),
    removedCount: z.number().int().nonnegative(),
    updatedCount: z.number().int().nonnegative(),
  }),
});

export const agentApprovalRequestSchema = z.object({
  threadId: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  commands: z.array(presentationCommandSchema),
  risk: z.enum(["low", "medium", "high"]).optional(),
  assumptions: z.array(z.string()).optional(),
  diff: agentApprovalDiffSchema.optional(),
  preview: presentationSchema.optional(),
});

const reviewCommandProposalEventSchema = z.object({
  ...commonDisplayEventShape,
  kind: z.literal("review.command-proposal"),
  category: z.literal("review"),
  payload: agentApprovalRequestSchema,
});

const reviewPatchReadyEventSchema = z.object({
  ...commonDisplayEventShape,
  kind: z.literal("review.patch-ready"),
  category: z.literal("review"),
  payload: z.object({
    patchId: z.string().trim().min(1),
    threadId: z.string().trim().min(1),
    targetPath: z.string().trim().min(1),
    summary: z.string(),
    contentBefore: z.string().optional(),
    contentAfter: z.string().optional(),
    revision: z.number().int().nonnegative().optional(),
  }),
});

const progressTaskGraphUpdatedEventSchema = z.object({
  ...commonDisplayEventShape,
  kind: z.literal("progress.task-graph-updated"),
  category: z.literal("progress"),
  payload: z.object({
    tasks: z.array(agentTaskNodeSchema),
    goal: z.string().nullable().optional(),
  }),
});

const artifactReadyEventSchema = z.object({
  ...commonDisplayEventShape,
  kind: z.literal("artifact.ready"),
  category: z.literal("artifact"),
  payload: z.object({
    artifactId: z.string().trim().min(1),
    artifactType: z.enum(["brief", "outline", "deck", "patch"]),
    title: z.string().optional(),
    revision: z.number().int().nonnegative().optional(),
  }),
});

const notificationMessageEventSchema = z.object({
  ...commonDisplayEventShape,
  kind: z.literal("notification.message"),
  category: z.literal("notification"),
  payload: z.object({
    message: z.string().trim().min(1),
    severity: z.enum(["info", "success", "warning", "error"]),
    ttlMs: z.number().int().positive().optional(),
    actionLabel: z.string().trim().min(1).optional(),
  }),
});

const environmentActionRequiredEventSchema = z.object({
  ...commonDisplayEventShape,
  kind: z.literal("environment.action-required"),
  category: z.literal("environment"),
  payload: z.object({
    code: z.string().trim().min(1),
    title: z.string().trim().min(1),
    message: z.string().trim().min(1),
    actionLabel: z.string().trim().min(1).optional(),
  }),
});

export const displayEventSchema = z.discriminatedUnion("kind", [
  permissionToolRequestedEventSchema,
  interactionQuestionRequestedEventSchema,
  interactionLayoutRequiredEventSchema,
  reviewCommandProposalEventSchema,
  reviewPatchReadyEventSchema,
  progressTaskGraphUpdatedEventSchema,
  artifactReadyEventSchema,
  notificationMessageEventSchema,
  environmentActionRequiredEventSchema,
]);

export type DisplayCardCategory = z.infer<typeof displayCardCategorySchema>;
export type DisplayCardSource = z.infer<typeof displayCardSourceSchema>;
export type DisplayEvent = z.infer<typeof displayEventSchema>;
export type DisplayEventKind = DisplayEvent["kind"];
export type AgentApprovalRequest = z.infer<typeof agentApprovalRequestSchema>;

export const displayCardActionSchema = z.object({
  protocolVersion: z.literal(1),
  eventId: z.string().trim().min(1),
  actionId: z.enum([
    "approve",
    "deny",
    "answer",
    "confirm-layout",
    "revise",
    "preview",
    "export",
    "dismiss",
    "retry",
  ]),
  payload: z.unknown().optional(),
  correlation: z.object({
    sessionId: z.string().trim().min(1).optional(),
    runId: z.string().trim().min(1).optional(),
    threadId: z.string().trim().min(1).optional(),
    toolCallId: z.string().trim().min(1).optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
  }),
});

export type DisplayCardAction = z.infer<typeof displayCardActionSchema>;

export const displayCardStatusSchema = z.enum([
  "active",
  "resolved",
  "dismissed",
  "superseded",
]);

export const persistedDisplayCardSchema = z.object({
  event: displayEventSchema,
  status: displayCardStatusSchema,
  receivedAt: z.number().int().nonnegative(),
  lastAction: displayCardActionSchema.optional(),
});

export type DisplayCardStatus = z.infer<typeof displayCardStatusSchema>;
export type PersistedDisplayCard = z.infer<typeof persistedDisplayCardSchema>;

export function createDisplayEventId(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}
