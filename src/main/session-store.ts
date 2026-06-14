import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { Presentation } from "@shared/presentation";
import {
  createSessionPresentation,
  createWelcomeMessage,
  sessionChatMessageSchema,
  sessionSnapshotSchema,
  type SessionBootstrap,
  type SessionChatMessage,
  type SessionSnapshot,
  type SessionSummary,
} from "@shared/session";

const storedSessionSchema = sessionSnapshotSchema;
const sessionFileSchema = z.object({
  version: z.literal(1),
  activeSessionId: z.string(),
  sessions: z.array(storedSessionSchema).min(1),
});

type SessionFile = z.infer<typeof sessionFileSchema>;

export class FileSessionStore {
  private data?: SessionFile;
  private writeQueue = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const parsed = sessionFileSchema.parse(JSON.parse(await readFile(this.filePath, "utf8")));
      const activeExists = parsed.sessions.some(
        (item) => item.session.id === parsed.activeSessionId,
      );
      this.data = activeExists
        ? parsed
        : { ...parsed, activeSessionId: parsed.sessions[0].session.id };
      const expiredApprovals = this.expirePendingApprovals();
      if (expiredApprovals || !activeExists) await this.persist();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && !(error instanceof SyntaxError) && !(error instanceof z.ZodError)) {
        throw error;
      }
      this.data = this.createInitialData();
      await this.persist();
    }
  }

  getBootstrap(): SessionBootstrap {
    const data = this.requireData();
    return {
      sessions: this.listSummaries(data),
      activeSession: structuredClone(this.findSession(data.activeSessionId)),
    };
  }

  getSession(sessionId: string): SessionSnapshot {
    return structuredClone(this.findSession(sessionId));
  }

  async createSession(): Promise<SessionBootstrap> {
    const data = this.requireData();
    const title = `新幻灯片会话 ${data.sessions.length + 1}`;
    const now = new Date().toISOString();
    const presentation = createSessionPresentation(title);
    const snapshot: SessionSnapshot = {
      session: this.toSummary(crypto.randomUUID(), now, now, presentation),
      presentation,
      messages: [createWelcomeMessage(title)],
    };
    data.sessions.unshift(snapshot);
    data.activeSessionId = snapshot.session.id;
    await this.persist();
    return this.getBootstrap();
  }

  async selectSession(sessionId: string): Promise<SessionBootstrap> {
    const data = this.requireData();
    this.findSession(sessionId);
    data.activeSessionId = sessionId;
    await this.persist();
    return this.getBootstrap();
  }

  async deleteSession(sessionId: string): Promise<SessionBootstrap> {
    const data = this.requireData();
    const index = data.sessions.findIndex((item) => item.session.id === sessionId);
    if (index === -1) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    data.sessions.splice(index, 1);
    if (data.sessions.length === 0) {
      const initial = this.createInitialData();
      data.sessions = initial.sessions;
      data.activeSessionId = initial.activeSessionId;
    } else if (data.activeSessionId === sessionId) {
      data.activeSessionId = data.sessions[0].session.id;
    }
    await this.persist();
    return this.getBootstrap();
  }

  async savePresentation(sessionId: string, presentation: Presentation): Promise<void> {
    const snapshot = this.findSession(sessionId);
    snapshot.presentation = structuredClone(presentation);
    snapshot.session = this.toSummary(
      snapshot.session.id,
      snapshot.session.createdAt,
      new Date().toISOString(),
      presentation,
    );
    await this.persist();
  }

  async saveMessages(sessionId: string, messages: SessionChatMessage[]): Promise<void> {
    const snapshot = this.findSession(sessionId);
    snapshot.messages = sessionChatMessageSchema.array().parse(structuredClone(messages));
    snapshot.session.updatedAt = new Date().toISOString();
    await this.persist();
  }

  private createInitialData(): SessionFile {
    const now = new Date().toISOString();
    const title = "未命名演示文稿";
    const presentation = createSessionPresentation(title);
    const snapshot: SessionSnapshot = {
      session: this.toSummary(crypto.randomUUID(), now, now, presentation),
      presentation,
      messages: [createWelcomeMessage()],
    };
    return { version: 1, activeSessionId: snapshot.session.id, sessions: [snapshot] };
  }

  private expirePendingApprovals(): boolean {
    let changed = false;
    for (const snapshot of this.requireData().sessions) {
      snapshot.messages = snapshot.messages.map((message) => {
        if (!message.approval) return message;
        changed = true;
        const { approval: _, ...rest } = message;
        return {
          ...rest,
          content: `${message.content}\n\n该审批请求已随应用重启失效，请重新提交指令。`,
        };
      });
    }
    return changed;
  }

  private toSummary(
    id: string,
    createdAt: string,
    updatedAt: string,
    presentation: Presentation,
  ): SessionSummary {
    return {
      id,
      title: presentation.title,
      createdAt,
      updatedAt,
      slideCount: presentation.slides.length,
      revision: presentation.revision,
    };
  }

  private listSummaries(data: SessionFile): SessionSummary[] {
    return [...data.sessions]
      .sort((a, b) => b.session.updatedAt.localeCompare(a.session.updatedAt))
      .map((item) => structuredClone(item.session));
  }

  private findSession(sessionId: string): SessionSnapshot {
    const snapshot = this.requireData().sessions.find((item) => item.session.id === sessionId);
    if (!snapshot) throw new Error(`Session not found: ${sessionId}`);
    return snapshot;
  }

  private requireData(): SessionFile {
    if (!this.data) throw new Error("Session store has not been initialized.");
    return this.data;
  }

  private async persist(): Promise<void> {
    const payload = `${JSON.stringify(this.requireData(), null, 2)}\n`;
    this.writeQueue = this.writeQueue.then(async () => {
      const temporaryPath = `${this.filePath}.tmp`;
      await writeFile(temporaryPath, payload, "utf8");
      await rename(temporaryPath, this.filePath);
    });
    await this.writeQueue;
  }
}
