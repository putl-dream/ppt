import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  buildConversationChain,
  transcriptMessageSchema,
  type TranscriptKind,
  type TranscriptMessage,
  type TranscriptRole,
} from "@shared/transcript";

export interface TranscriptMessageInput {
  uuid?: string;
  parentUuid?: string;
  isSidechain?: boolean;
  agentId?: string;
  role: TranscriptRole;
  kind?: TranscriptKind;
  content: unknown;
  cwd?: string;
  timestamp?: string;
  gitBranch?: string;
  runId?: string;
  threadId?: string;
  metadata?: Record<string, unknown>;
}

export interface InsertMessageChainOptions {
  sessionId: string;
  projectDir: string;
  cwd?: string;
  parentUuid?: string;
  messages: TranscriptMessageInput[];
}

export class TranscriptStore {
  private readonly writeQueues = new Map<string, Promise<void>>();

  constructor(private readonly transcriptDirectoryName = "transcripts") {}

  getTranscriptPath(sessionId: string, projectDir: string): string {
    return join(projectDir, this.transcriptDirectoryName, `${sessionId}.jsonl`);
  }

  async loadTranscriptFile(sessionId: string, projectDir: string): Promise<TranscriptMessage[]> {
    const filePath = this.getTranscriptPath(sessionId, projectDir);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }

    return raw
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line, index) => {
        try {
          return transcriptMessageSchema.parse(JSON.parse(line));
        } catch (error) {
          throw new Error(
            `Invalid transcript JSONL at ${filePath}:${index + 1}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      });
  }

  async loadConversationChain(
    sessionId: string,
    projectDir: string,
    leafMessageUuid?: string,
  ): Promise<TranscriptMessage[]> {
    const messages = await this.loadTranscriptFile(sessionId, projectDir);
    if (messages.length === 0) return [];
    const leafUuid = leafMessageUuid ?? messages.at(-1)?.uuid;
    if (!leafUuid) return [];
    return buildConversationChain(messages, leafUuid);
  }

  async insertMessageChain(options: InsertMessageChainOptions): Promise<TranscriptMessage[]> {
    if (options.messages.length === 0) return [];

    const filePath = this.getTranscriptPath(options.sessionId, options.projectDir);
    const existing = await this.loadTranscriptFile(options.sessionId, options.projectDir);
    const writtenUuids = new Set(existing.map((message) => message.uuid));
    let parentUuid = options.parentUuid;
    const now = new Date().toISOString();

    const nextMessages = options.messages.map((message) => {
      const uuid = message.uuid ?? crypto.randomUUID();
      const item = transcriptMessageSchema.parse({
        uuid,
        parentUuid: message.parentUuid ?? parentUuid,
        isSidechain: message.isSidechain ?? false,
        agentId: message.agentId,
        sessionId: options.sessionId,
        role: message.role,
        kind: message.kind ?? "message",
        content: message.content,
        cwd: message.cwd ?? options.cwd ?? options.projectDir,
        projectDir: options.projectDir,
        timestamp: message.timestamp ?? now,
        version: 1,
        gitBranch: message.gitBranch,
        runId: message.runId,
        threadId: message.threadId,
        metadata: message.metadata,
      });
      parentUuid = item.uuid;
      return item;
    });

    const unwritten = nextMessages.filter((message) => !writtenUuids.has(message.uuid));
    if (unwritten.length === 0) return nextMessages;

    await this.enqueueAppend(
      filePath,
      unwritten.map((message) => JSON.stringify(message)).join("\n") + "\n",
    );

    return nextMessages;
  }

  private async enqueueAppend(filePath: string, payload: string): Promise<void> {
    const previous = this.writeQueues.get(filePath) ?? Promise.resolve();
    const next = previous.then(async () => {
      await mkdir(dirname(filePath), { recursive: true });
      await appendFile(filePath, payload, "utf8");
    });
    this.writeQueues.set(filePath, next.catch(() => undefined));
    await next;
  }
}
