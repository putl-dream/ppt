import { z } from "zod";
import { agentActivityItemSchema } from "./agent-activity";
import { presentationSchema, type Presentation } from "./presentation";
import { presentationCommandSchema } from "./commands";
import { agentExecutionStrategySchema, agentModelSelectionSchema } from "./agent";

export const projectArtifactKindSchema = z.enum([
  "brief",
  "outline",
  "research",
  "slide-plan",
  "design",
  "deck",
  "history",
]);

export const projectArtifactStatusSchema = z.enum(["draft", "ready", "stale"]);

export const projectArtifactSchema = z.object({
  id: z.string(),
  title: z.string(),
  path: z.string(),
  kind: projectArtifactKindSchema,
  status: projectArtifactStatusSchema,
  dependsOn: z.array(z.string()),
});

export const projectSandboxSchema = z.object({
  rootPath: z.string(),
  artifacts: z.array(projectArtifactSchema),
});

export const sessionTranscriptSchema = z.object({
  path: z.string(),
  leafMessageUuid: z.string().optional(),
});

const persistedOutlineSchema = z.object({
  threadId: z.string(),
  message: z.string(),
  outline: z.object({
    title: z.string(),
    audience: z.string().optional(),
    objective: z.string().optional(),
    slides: z.array(z.object({
      title: z.string(),
      keyPoints: z.array(z.string()),
    })),
  }).optional(),
  missingInformation: z.array(z.string()),
  model: agentModelSelectionSchema.optional(),
  executionStrategy: agentExecutionStrategySchema.optional(),
});

const persistedApprovalDiffSchema = z.object({
  titleChanged: z.boolean(),
  oldTitle: z.string(),
  newTitle: z.string(),
  themeChanged: z.boolean(),
  slidesAddedCount: z.number().int().nonnegative(),
  slidesRemovedCount: z.number().int().nonnegative(),
  affectedSlideIds: z.array(z.string()),
  elementChanges: z.object({
    addedCount: z.number().int().nonnegative(),
    removedCount: z.number().int().nonnegative(),
    updatedCount: z.number().int().nonnegative(),
  }),
});

const persistedApprovalSchema = z.object({
  threadId: z.string(),
  summary: z.string(),
  commands: z.array(presentationCommandSchema),
  risk: z.enum(["low", "medium", "high"]).optional(),
  assumptions: z.array(z.string()).optional(),
  diff: persistedApprovalDiffSchema.optional(),
});

const persistedPatchSchema = z.object({
  threadId: z.string(),
  targetPath: z.string(),
  summary: z.string(),
  contentBefore: z.string().optional(),
  contentAfter: z.string().optional(),
  resolved: z.enum(["accepted", "rejected"]).optional(),
});

const persistedInlineCardSchema = z.object({
  type: z.enum(["brief", "outline", "layout", "deck"]),
  resolved: z.enum(["confirmed", "dismissed"]).optional(),
  layoutMode: z.enum(["template", "creative"]).optional(),
});

export const sessionChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  thought: z.array(z.string()).optional(),
  reasoning: z.string().optional(),
  activityTrace: z.array(agentActivityItemSchema).optional(),
  progress: z.number().optional(),
  approval: persistedApprovalSchema.optional(),
  patch: persistedPatchSchema.optional(),
  inlineCards: z.array(persistedInlineCardSchema).optional(),
  threadId: z.string().optional(),
});

export const sessionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastMessageAt: z.string().optional(),
  slideCount: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  workspacePath: z.string().optional(),
});

export const sessionSnapshotSchema = z.object({
  session: sessionSummarySchema,
  project: projectSandboxSchema.optional(),
  transcript: sessionTranscriptSchema.optional(),
  presentation: presentationSchema,
  messages: z.array(sessionChatMessageSchema),
});

export const sessionBootstrapSchema = z.object({
  sessions: z.array(sessionSummarySchema),
  activeSession: sessionSnapshotSchema.optional(),
});

export type SessionChatMessage = z.infer<typeof sessionChatMessageSchema>;
export type ProjectArtifactStatus = z.infer<typeof projectArtifactStatusSchema>;
export type ProjectArtifact = z.infer<typeof projectArtifactSchema>;
export type ProjectSandbox = z.infer<typeof projectSandboxSchema>;
export type SessionTranscript = z.infer<typeof sessionTranscriptSchema>;
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type SessionSnapshot = z.infer<typeof sessionSnapshotSchema>;
export type SessionBootstrap = z.infer<typeof sessionBootstrapSchema>;

export function createSessionPresentation(title: string): Presentation {
  // 新项目从空 deck 起步：不预置占位页，避免 Agent 每次 ReadPresentationSnapshot
  // 都读到无意义的占位内容。首页内容由 Agent 首次 add-slide 生成。
  return {
    id: crypto.randomUUID(),
    title,
    revision: 0,
    slides: [],
  };
}

export function createWelcomeMessage(title?: string): SessionChatMessage {
  return {
    id: "init",
    role: "assistant",
    content: title
      ? `已为您创建 PPT 项目【${title}】。这个会话现在以项目目录为沙箱：先整理 brief.md 的目的、受众和方向，再推进 outline.md、research/、slides/、design/ 与 deck/。`
      : "已初始化一个 PPT 项目沙箱。我们会先明确目的、方向和受众，再沉淀大纲、资料、逐页方案，最后制作 PPT。",
  };
}
