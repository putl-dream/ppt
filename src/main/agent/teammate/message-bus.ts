import { mkdir, readFile, rm, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";

type LockRelease = () => Promise<void>;
type LockOptions = {
  realpath?: boolean;
  stale?: number;
  retries?: number | {
    retries?: number;
    factor?: number;
    minTimeout?: number;
    maxTimeout?: number;
  };
};
type ProperLockfile = {
  lock(file: string, options?: LockOptions): Promise<LockRelease>;
};

const require = createRequire(import.meta.url);
const lockfile = require("proper-lockfile") as ProperLockfile;

export type AgentMailboxMessageType =
  | "message"
  | "result"
  | "idle_notification"
  | "permission_request"
  | "permission_response"
  | "shutdown_request"
  | "shutdown_response"
  | "plan_approval_request"
  | "plan_approval_response"
  | "error";

export interface AgentMailboxMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  type: AgentMailboxMessageType;
  ts: number;
  payload?: Record<string, unknown>;
}

export interface SendMailboxMessageInput {
  from: string;
  to: string;
  content: string;
  type?: AgentMailboxMessageType;
  payload?: Record<string, unknown>;
}

const LOCK_OPTIONS: LockOptions = {
  realpath: false,
  stale: 5_000,
  retries: {
    retries: 20,
    factor: 1,
    minTimeout: 10,
    maxTimeout: 75,
  },
};

export function sanitizeAgentName(name: string): string {
  const sanitized = name.trim().replace(/[^a-zA-Z0-9_.-]+/g, "_");
  return sanitized || "agent";
}

export function formatMailboxMessagesForHistory(messages: AgentMailboxMessage[]): string {
  return messages.map((message) => {
    const content = message.content.trim().slice(0, 1_000);
    const prefix = `From ${message.from} [${message.type}]`;
    if (message.type === "permission_request") {
      const toolName = typeof message.payload?.toolName === "string"
        ? message.payload.toolName
        : "unknown";
      const reason = typeof message.payload?.reason === "string"
        ? message.payload.reason
        : content;
      return `${prefix}: permission requested for ${toolName}. ${reason}`;
    }
    if (message.type === "permission_response") {
      const approved = message.payload?.approved === true ? "approved" : "denied";
      return `${prefix}: permission ${approved}. ${content}`;
    }
    if (message.type === "shutdown_response" || message.type === "plan_approval_response") {
      const status = message.payload?.approve === true ? "approved" : "rejected";
      const requestId = typeof message.payload?.requestId === "string"
        ? message.payload.requestId
        : "unknown";
      return `${prefix}: request ${requestId} ${status}. ${content}`;
    }
    if (message.type === "shutdown_request" || message.type === "plan_approval_request") {
      const requestId = typeof message.payload?.requestId === "string"
        ? message.payload.requestId
        : "unknown";
      return `${prefix}: request ${requestId}. ${content}`;
    }
    return `${prefix}: ${content}`;
  }).join("\n");
}

export class MessageBus {
  constructor(private readonly mailboxDir: string) {}

  static defaultMailboxDir(workspaceRoot: string): string {
    return join(workspaceRoot, ".agents", "mailboxes");
  }

  getInboxPath(agent: string): string {
    return join(this.mailboxDir, `${sanitizeAgentName(agent)}.jsonl`);
  }

  async send(input: SendMailboxMessageInput): Promise<AgentMailboxMessage> {
    const message: AgentMailboxMessage = {
      id: crypto.randomUUID(),
      from: sanitizeAgentName(input.from),
      to: sanitizeAgentName(input.to),
      content: input.content,
      type: input.type ?? "message",
      ts: Date.now() / 1_000,
      ...(input.payload ? { payload: input.payload } : {}),
    };
    const inboxPath = this.getInboxPath(message.to);

    await this.withMailboxLock(inboxPath, async () => {
      await appendFile(inboxPath, `${JSON.stringify(message)}\n`, "utf8");
    });

    return message;
  }

  async readInbox(agent: string): Promise<AgentMailboxMessage[]> {
    const inboxPath = this.getInboxPath(agent);
    return this.withMailboxLock(inboxPath, async () => {
      const messages = await this.readMessagesUnlocked(inboxPath);
      if (messages.length > 0) {
        await rm(inboxPath, { force: true });
      }
      return messages;
    });
  }

  async peekInbox(agent: string): Promise<AgentMailboxMessage[]> {
    const inboxPath = this.getInboxPath(agent);
    return this.withMailboxLock(inboxPath, async () =>
      this.readMessagesUnlocked(inboxPath),
    );
  }

  private async withMailboxLock<T>(inboxPath: string, fn: () => Promise<T>): Promise<T> {
    await mkdir(this.mailboxDir, { recursive: true });
    const release = await lockfile.lock(inboxPath, LOCK_OPTIONS);
    try {
      return await fn();
    } finally {
      await release();
    }
  }

  private async readMessagesUnlocked(inboxPath: string): Promise<AgentMailboxMessage[]> {
    let raw = "";
    try {
      raw = await readFile(inboxPath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return [];
      throw error;
    }

    return raw.split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [parseMailboxMessage(JSON.parse(line))];
        } catch {
          return [];
        }
      });
  }
}

function parseMailboxMessage(value: unknown): AgentMailboxMessage {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid mailbox message.");
  }
  const record = value as Record<string, unknown>;
  return {
    id: typeof record.id === "string" ? record.id : crypto.randomUUID(),
    from: sanitizeAgentName(typeof record.from === "string" ? record.from : "unknown"),
    to: sanitizeAgentName(typeof record.to === "string" ? record.to : "unknown"),
    content: typeof record.content === "string" ? record.content : "",
    type: isMailboxMessageType(record.type) ? record.type : "message",
    ts: typeof record.ts === "number" ? record.ts : Date.now() / 1_000,
    ...(record.payload && typeof record.payload === "object"
      ? { payload: record.payload as Record<string, unknown> }
      : {}),
  };
}

function isMailboxMessageType(value: unknown): value is AgentMailboxMessageType {
  return value === "message"
    || value === "result"
    || value === "idle_notification"
    || value === "permission_request"
    || value === "permission_response"
    || value === "shutdown_request"
    || value === "shutdown_response"
    || value === "plan_approval_request"
    || value === "plan_approval_response"
    || value === "error";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
