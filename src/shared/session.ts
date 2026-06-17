import { z } from "zod";
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

const persistedApprovalSchema = z.object({
  threadId: z.string(),
  summary: z.string(),
  commands: z.array(presentationCommandSchema),
});

export const sessionChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  thought: z.array(z.string()).optional(),
  progress: z.number().optional(),
  approval: persistedApprovalSchema.optional(),
  outlineRequest: persistedOutlineSchema.optional(),
});

export const sessionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  slideCount: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
});

export const sessionSnapshotSchema = z.object({
  session: sessionSummarySchema,
  project: projectSandboxSchema.optional(),
  presentation: presentationSchema,
  messages: z.array(sessionChatMessageSchema),
});

export const sessionBootstrapSchema = z.object({
  sessions: z.array(sessionSummarySchema),
  activeSession: sessionSnapshotSchema,
});

export type SessionChatMessage = z.infer<typeof sessionChatMessageSchema>;
export type ProjectArtifactStatus = z.infer<typeof projectArtifactStatusSchema>;
export type ProjectArtifact = z.infer<typeof projectArtifactSchema>;
export type ProjectSandbox = z.infer<typeof projectSandboxSchema>;
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type SessionSnapshot = z.infer<typeof sessionSnapshotSchema>;
export type SessionBootstrap = z.infer<typeof sessionBootstrapSchema>;

export function createSessionPresentation(title: string): Presentation {
  return {
    id: crypto.randomUUID(),
    title,
    revision: 0,
    slides: [
      {
        id: crypto.randomUUID(),
        title: "项目起点",
        elements: [
          {
            id: crypto.randomUUID(),
            type: "text",
            x: 120,
            y: 156,
            width: 1040,
            height: 96,
            text: "PPT 项目工作台",
            fontSize: 58,
            bold: true,
          },
          {
            id: crypto.randomUUID(),
            type: "text",
            x: 150,
            y: 292,
            width: 980,
            height: 180,
            text: `当前项目：${title}\n先明确目的、受众和方向，再沉淀大纲、资料、逐页方案，最后生成 PPT。`,
            fontSize: 28,
          },
        ],
      },
    ],
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
