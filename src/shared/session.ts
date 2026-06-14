import { z } from "zod";
import { presentationSchema, type Presentation } from "./presentation";
import { presentationCommandSchema } from "./commands";

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
  presentation: presentationSchema,
  messages: z.array(sessionChatMessageSchema),
});

export const sessionBootstrapSchema = z.object({
  sessions: z.array(sessionSummarySchema),
  activeSession: sessionSnapshotSchema,
});

export type SessionChatMessage = z.infer<typeof sessionChatMessageSchema>;
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
        title: "新建会话封面",
        elements: [
          {
            id: crypto.randomUUID(),
            type: "text",
            x: 120,
            y: 220,
            width: 1040,
            height: 180,
            text: title,
            fontSize: 52,
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
      ? `您好！已为您开启新的会话【${title}】。请告诉我您的排版大纲，我将为您生成排版命令。`
      : "您好！我是您的 Agent PPT 协同设计助手。请告诉我想制作什么样的幻灯片，我将为您生成排版指令方案。",
  };
}
