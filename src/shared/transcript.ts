import { z } from "zod";

export const transcriptRoleSchema = z.enum(["user", "assistant", "tool", "system"]);

export const transcriptKindSchema = z.enum([
  "message",
  "tool_use",
  "tool_result",
  "compact_boundary",
  "approval",
  "outline",
]);

export const transcriptMessageSchema = z.object({
  uuid: z.string(),
  parentUuid: z.string().optional(),
  isSidechain: z.boolean(),
  agentId: z.string().optional(),
  sessionId: z.string(),
  role: transcriptRoleSchema,
  kind: transcriptKindSchema.default("message"),
  content: z.unknown(),
  cwd: z.string(),
  projectDir: z.string(),
  timestamp: z.string(),
  version: z.literal(1),
  gitBranch: z.string().optional(),
  runId: z.string().optional(),
  threadId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type TranscriptRole = z.infer<typeof transcriptRoleSchema>;
export type TranscriptKind = z.infer<typeof transcriptKindSchema>;
export type TranscriptMessage = z.infer<typeof transcriptMessageSchema>;

export type AgentContextMessage = {
  role: "user" | "assistant";
  content: string;
};

export const NO_RESPONSE_REQUESTED = "[NO_RESPONSE_REQUESTED]";

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          const text = (item as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object" && "text" in content) {
    const text = (content as { text?: unknown }).text;
    return typeof text === "string" ? text : "";
  }
  return "";
}

export function buildConversationChain(
  messages: TranscriptMessage[],
  leafMessageOrUuid: TranscriptMessage | string,
): TranscriptMessage[] {
  const byUuid = new Map(messages.map((message) => [message.uuid, message]));
  const leafUuid = typeof leafMessageOrUuid === "string"
    ? leafMessageOrUuid
    : leafMessageOrUuid.uuid;
  const chain: TranscriptMessage[] = [];
  const seen = new Set<string>();
  let current = byUuid.get(leafUuid);

  if (!current) {
    throw new Error(`Transcript leaf message not found: ${leafUuid}`);
  }

  while (current) {
    if (seen.has(current.uuid)) {
      throw new Error(`Transcript parent chain contains a cycle at: ${current.uuid}`);
    }
    seen.add(current.uuid);
    chain.push(current);

    if (!current.parentUuid) break;
    const parent = byUuid.get(current.parentUuid);
    if (!parent) {
      throw new Error(`Transcript parent message not found: ${current.parentUuid}`);
    }
    current = parent;
  }

  return chain.reverse();
}

export function deserializeMessages(chain: TranscriptMessage[]): AgentContextMessage[] {
  const contextMessages = chain
    .filter((message) => !message.isSidechain)
    .filter((message) => message.role === "user" || message.role === "assistant")
    .filter((message) =>
      message.kind === "message" ||
      message.kind === "outline" ||
      message.kind === "approval" ||
      message.kind === "compact_boundary",
    )
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: contentToText(message.content).trim(),
    }))
    .filter((message) => message.role !== "assistant" || message.content.length > 0);

  const last = contextMessages.at(-1);
  if (last?.role === "user") {
    return [
      ...contextMessages,
      { role: "assistant", content: NO_RESPONSE_REQUESTED },
    ];
  }

  return contextMessages;
}
