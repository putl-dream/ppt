import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  buildConversationChain,
  transcriptMessageSchema,
  type TranscriptKind,
  type TranscriptMessage,
  type TranscriptRole,
} from "@shared/transcript";
import { writeTextFileAtomic } from "./agent/persistence/atomic-json-file";

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
  private readonly operationQueues = new Map<string, Promise<void>>();

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

    const lines = raw
      .split(/\r?\n/)
      .map((line, index) => ({ line, lineNumber: index + 1 }))
      .filter((entry) => entry.line.trim().length > 0);
    const messages: TranscriptMessage[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const entry = lines[index];
      let parsed: unknown;
      try {
        parsed = JSON.parse(entry.line);
      } catch (error) {
        // A process kill can truncate only the final append. Preserve all
        // committed records and ignore that incomplete tail; corruption in the
        // middle remains fatal.
        if (index === lines.length - 1) break;
        throw new Error(
          `Invalid transcript JSONL at ${filePath}:${entry.lineNumber}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      try {
        messages.push(transcriptMessageSchema.parse(parsed));
      } catch (error) {
        throw new Error(
          `Invalid transcript JSONL schema at ${filePath}:${entry.lineNumber}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return messages;
  }

  async loadConversationChain(
    sessionId: string,
    projectDir: string,
    leafMessageUuid?: string,
    options?: { recoverTail?: boolean },
  ): Promise<TranscriptMessage[]> {
    const messages = await this.loadTranscriptFile(sessionId, projectDir);
    if (messages.length === 0) return [];
    let leafUuid = leafMessageUuid ?? messages.at(-1)?.uuid;
    if (!leafUuid) return [];
    if (!messages.some((message) => message.uuid === leafUuid)) {
      leafUuid = messages.at(-1)?.uuid;
    } else if (options?.recoverTail) {
      leafUuid = findLatestDescendantLeaf(messages, leafUuid);
    }
    if (!leafUuid) return [];
    return buildConversationChain(messages, leafUuid);
  }

  async insertMessageChain(options: InsertMessageChainOptions): Promise<TranscriptMessage[]> {
    if (options.messages.length === 0) return [];

    const filePath = this.getTranscriptPath(options.sessionId, options.projectDir);
    const previous = this.operationQueues.get(filePath) ?? Promise.resolve();
    const operation = previous.then(() => this.insertMessageChainUnlocked(filePath, options));
    this.operationQueues.set(filePath, operation.then(() => undefined, () => undefined));
    return operation;
  }

  private async insertMessageChainUnlocked(
    filePath: string,
    options: InsertMessageChainOptions,
  ): Promise<TranscriptMessage[]> {
    const existing = await this.loadTranscriptFile(options.sessionId, options.projectDir);
    const existingByUuid = new Map(existing.map((message) => [message.uuid, message]));
    let parentUuid = options.parentUuid;
    const now = new Date().toISOString();

    const nextMessages = options.messages.map((message) => {
      const uuid = message.uuid ?? crypto.randomUUID();
      const stored = existingByUuid.get(uuid);
      const item = transcriptMessageSchema.parse({
        uuid,
        parentUuid: message.parentUuid ?? parentUuid ?? stored?.parentUuid,
        isSidechain: message.isSidechain ?? stored?.isSidechain ?? false,
        agentId: message.agentId ?? stored?.agentId,
        sessionId: options.sessionId,
        role: message.role,
        kind: message.kind ?? "message",
        content: message.content,
        cwd: message.cwd ?? options.cwd ?? options.projectDir,
        projectDir: options.projectDir,
        timestamp: message.timestamp ?? stored?.timestamp ?? now,
        version: 1,
        gitBranch: message.gitBranch ?? stored?.gitBranch,
        runId: message.runId ?? stored?.runId,
        threadId: message.threadId,
        metadata: message.metadata,
      });
      parentUuid = item.uuid;
      return item;
    });

    const unwritten = nextMessages.filter((message) => !existingByUuid.has(message.uuid));
    const changedExisting = nextMessages.some((message) => {
      const stored = existingByUuid.get(message.uuid);
      return stored !== undefined && JSON.stringify(stored) !== JSON.stringify(message);
    });
    if (changedExisting) {
      const replacements = new Map(nextMessages.map((message) => [message.uuid, message]));
      const merged = existing.map((message) => replacements.get(message.uuid) ?? message);
      merged.push(...unwritten);
      await this.enqueueReplace(
        filePath,
        merged.map((message) => JSON.stringify(message)).join("\n") + "\n",
      );
      return nextMessages;
    }
    if (unwritten.length === 0) return nextMessages;

    await this.enqueueAppend(
      filePath,
      unwritten.map((message) => JSON.stringify(message)).join("\n") + "\n",
    );

    return nextMessages;
  }

  private async enqueueReplace(filePath: string, payload: string): Promise<void> {
    const previous = this.writeQueues.get(filePath) ?? Promise.resolve();
    const next = previous.then(() => writeTextFileAtomic(filePath, payload));
    this.writeQueues.set(filePath, next.catch(() => undefined));
    await next;
  }

  private async enqueueAppend(filePath: string, payload: string): Promise<void> {
    const previous = this.writeQueues.get(filePath) ?? Promise.resolve();
    const next = previous.then(async () => {
      await mkdir(dirname(filePath), { recursive: true });
      const handle = await open(filePath, "a");
      try {
        await handle.writeFile(payload, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
    });
    this.writeQueues.set(filePath, next.catch(() => undefined));
    await next;
  }
}

function findLatestDescendantLeaf(messages: TranscriptMessage[], initialLeaf: string): string {
  let leaf = initialLeaf;
  for (const message of messages) {
    if (!message.isSidechain && message.parentUuid === leaf) {
      leaf = message.uuid;
    }
  }
  return leaf;
}
