import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { Presentation } from "@shared/presentation";
import {
  createSessionPresentation,
  createWelcomeMessage,
  type ProjectArtifactStatus,
  sessionChatMessageSchema,
  sessionSnapshotSchema,
  type SessionBootstrap,
  type SessionChatMessage,
  type SessionSnapshot,
  type SessionSummary,
} from "@shared/session";
import { deserializeSessionMessages } from "@shared/transcript";
import {
  toAgentMessageHistory,
  type AgentConversationMessage,
} from "@shared/session-recovery";
import { type ArtifactDiff } from "./project/artifact-diff";
import {
  ProjectFileService,
  type ProjectArtifactReadResult,
  type ProjectArtifactWriteResult,
} from "./project/project-file-service";
import {
  ExportHistoryService,
  GenerationJobsService,
} from "./deck/deck-persistence-services";
import type { DeckExportRecord, DeckGenerationJobsFile } from "@shared/deck-persistence";
import { parseStoryboard, serializeStoryboard, type StoryboardSlideSpec } from "@shared/storyboard";
import { TranscriptStore, type TranscriptMessageInput } from "./transcript-store";
import { defaultProjectArtifacts } from "@shared/project";
import type { CreateSessionOptions } from "@shared/ipc";
import { normalizeWorkspacePath } from "@shared/workspace";

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
  private readonly projectFileService: ProjectFileService;
  private readonly generationJobsService: GenerationJobsService;
  private readonly exportHistoryService: ExportHistoryService;
  private readonly transcriptStore = new TranscriptStore();
  private readonly expiredApprovalMessageIds = new Set<string>();

  constructor(private readonly filePath: string, projectRootPath?: string) {
    this.projectFileService = new ProjectFileService(
      projectRootPath ?? join(dirname(filePath), "projects"),
    );
    this.generationJobsService = new GenerationJobsService(this.projectFileService);
    this.exportHistoryService = new ExportHistoryService(this.projectFileService);
  }

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
      const projectChanged = await this.materializeProjectSandboxes();
      const transcriptChanged = await this.hydrateMessagesFromTranscripts();
      const expiredApprovals = this.expirePendingApprovals();
      if (expiredApprovals || transcriptChanged || projectChanged || !activeExists) {
        await this.persist();
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && !(error instanceof SyntaxError) && !(error instanceof z.ZodError)) {
        throw error;
      }
      this.data = this.createInitialData();
      await this.materializeProjectSandboxes();
      await this.hydrateMessagesFromTranscripts();
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

  getAgentMessageHistory(
    sessionId: string,
    currentRequest?: string,
  ): AgentConversationMessage[] {
    return toAgentMessageHistory(this.findSession(sessionId).messages, currentRequest);
  }



  async switchLeaf(sessionId: string, leafMessageUuid: string): Promise<SessionSnapshot> {
    const snapshot = this.findSession(sessionId);
    if (!snapshot.project || !snapshot.transcript) {
      throw new Error("Session transcript has not been initialized.");
    }
    await this.transcriptStore.loadConversationChain(
      sessionId,
      snapshot.project.rootPath,
      leafMessageUuid,
    );
    snapshot.transcript.leafMessageUuid = leafMessageUuid;
    await this.hydrateMessagesFromTranscript(snapshot);
    snapshot.session.updatedAt = new Date().toISOString();
    await this.persist();
    return structuredClone(snapshot);
  }

  async createSession(options?: CreateSessionOptions): Promise<SessionBootstrap> {
    const data = this.requireData();
    const title = options?.title ?? `新 PPT 项目 ${data.sessions.length + 1}`;
    const now = new Date().toISOString();
    const presentation = createSessionPresentation(title);
    const snapshot: SessionSnapshot = {
      session: this.toSummary(crypto.randomUUID(), now, now, presentation),
      presentation,
      messages: [createWelcomeMessage(title)],
    };

    if (options?.rootPath) {
      snapshot.project = {
        rootPath: normalizeWorkspacePath(options.rootPath),
        artifacts: defaultProjectArtifacts.map((artifact) => ({ ...artifact })),
      };
    }

    await this.materializeProjectSandbox(snapshot);
    await this.recordTranscriptMessages(snapshot, snapshot.messages);
    data.sessions.unshift(snapshot);
    data.activeSessionId = snapshot.session.id;
    await this.persist();
    return this.getBootstrap();
  }

  async openWorkspace(rootPath: string): Promise<SessionBootstrap> {
    const normalized = normalizeWorkspacePath(rootPath);
    const matches = this.requireData().sessions.filter(
      (snapshot) =>
        snapshot.project?.rootPath &&
        normalizeWorkspacePath(snapshot.project.rootPath) === normalized,
    );

    if (matches.length > 0) {
      const latest = [...matches].sort((left, right) =>
        right.session.updatedAt.localeCompare(left.session.updatedAt),
      )[0];
      return this.selectSession(latest.session.id);
    }

    return this.createSession({ rootPath: normalized });
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
      await this.materializeProjectSandboxes();
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
    await this.projectFileService.writeDeckSnapshot(snapshot, { markStale: false });
    await this.persist();
  }

  async recordDeckExport(
    sessionId: string,
    record: Omit<DeckExportRecord, "exportedAt"> & { exportedAt?: string },
  ): Promise<void> {
    const snapshot = this.findSession(sessionId);
    await this.exportHistoryService.appendExport(snapshot, {
      ...record,
      exportedAt: record.exportedAt ?? new Date().toISOString(),
    });
    snapshot.session.updatedAt = new Date().toISOString();
    await this.persist();
  }

  readGenerationJobs(sessionId: string) {
    return this.generationJobsService.read(this.findSession(sessionId));
  }

  async writeGenerationJobs(sessionId: string, file: DeckGenerationJobsFile): Promise<void> {
    const snapshot = this.findSession(sessionId);
    await this.generationJobsService.save(snapshot, file);
    snapshot.session.updatedAt = new Date().toISOString();
    await this.persist();
  }

  readExportHistory(sessionId: string) {
    return this.exportHistoryService.read(this.findSession(sessionId));
  }

  async readStoryboard(sessionId: string): Promise<StoryboardSlideSpec[]> {
    const artifact = await this.readProjectArtifact(sessionId, "slides/storyboard.json");
    return parseStoryboard(artifact.content ?? "[]");
  }

  async writeStoryboard(sessionId: string, storyboard: StoryboardSlideSpec[]): Promise<void> {
    await this.writeProjectArtifact(sessionId, "slides/storyboard.json", serializeStoryboard(storyboard));
  }

  createDeckGenerationJobStore(_sessionId: string) {
    return {
      readJobs: async (sessionId: string) => this.readGenerationJobs(sessionId),
      writeJobs: async (sessionId: string, file: DeckGenerationJobsFile) => {
        await this.writeGenerationJobs(sessionId, file);
      },
      writeStoryboard: async (sessionId: string, storyboard: StoryboardSlideSpec[]) => {
        await this.writeStoryboard(sessionId, storyboard);
      },
    };
  }

  async saveMessages(sessionId: string, messages: SessionChatMessage[]): Promise<void> {
    const snapshot = this.findSession(sessionId);
    const parsedMessages = sessionChatMessageSchema.array().parse(structuredClone(messages));
    await this.materializeProjectSandbox(snapshot);
    await this.recordTranscriptMessages(snapshot, parsedMessages);
    await this.hydrateMessagesFromTranscript(snapshot);
    snapshot.session.updatedAt = new Date().toISOString();
    await this.persist();
  }

  listProjectArtifacts(sessionId: string) {
    return this.projectFileService.listArtifacts(this.findSession(sessionId));
  }

  readProjectArtifact(
    sessionId: string,
    artifactIdOrPath: string,
  ): Promise<ProjectArtifactReadResult> {
    return this.projectFileService.readArtifact(this.findSession(sessionId), artifactIdOrPath);
  }

  getProjectArtifactDiff(
    sessionId: string,
    relativePath: string,
    nextContent: string,
  ): Promise<ArtifactDiff> {
    return this.projectFileService.getArtifactDiff(
      this.findSession(sessionId),
      relativePath,
      nextContent,
    );
  }

  async writeProjectArtifact(
    sessionId: string,
    relativePath: string,
    content: string,
  ): Promise<ProjectArtifactWriteResult> {
    const snapshot = this.findSession(sessionId);
    const result = await this.projectFileService.writeArtifact(snapshot, relativePath, content);
    if (result.changed) {
      snapshot.session.updatedAt = new Date().toISOString();
      await this.persist();
    }
    return result;
  }

  async markProjectArtifactStatus(
    sessionId: string,
    artifactId: string,
    status: ProjectArtifactStatus,
  ) {
    const snapshot = this.findSession(sessionId);
    const artifact = this.projectFileService.markArtifactStatus(snapshot, artifactId, status);
    snapshot.session.updatedAt = new Date().toISOString();
    await this.persist();
    return artifact;
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

  private async materializeProjectSandboxes(): Promise<boolean> {
    let changed = false;
    for (const snapshot of this.requireData().sessions) {
      changed = (await this.materializeProjectSandbox(snapshot)) || changed;
    }
    return changed;
  }

  private async hydrateMessagesFromTranscripts(): Promise<boolean> {
    let changed = false;
    for (const snapshot of this.requireData().sessions) {
      changed = (await this.hydrateMessagesFromTranscript(snapshot)) || changed;
    }
    return changed;
  }

  private async hydrateMessagesFromTranscript(snapshot: SessionSnapshot): Promise<boolean> {
    if (!snapshot.project || !snapshot.transcript) {
      throw new Error("Session transcript has not been initialized.");
    }

    const chain = await this.transcriptStore.loadConversationChain(
      snapshot.session.id,
      snapshot.project.rootPath,
      snapshot.transcript.leafMessageUuid,
    );

    if (chain.length === 0) {
      if (snapshot.messages.length === 0) return false;
      await this.recordTranscriptMessages(snapshot, snapshot.messages);
      return true;
    }

    const messages = deserializeSessionMessages(chain).map((message) =>
      this.expiredApprovalMessageIds.has(message.id)
        ? this.toExpiredApprovalMessage(message)
        : message,
    );
    const leafMessageUuid = chain.at(-1)?.uuid;
    const changed =
      JSON.stringify(snapshot.messages) !== JSON.stringify(messages) ||
      snapshot.transcript.leafMessageUuid !== leafMessageUuid;
    snapshot.messages = messages;
    snapshot.transcript.leafMessageUuid = leafMessageUuid;
    return changed;
  }

  private async materializeProjectSandbox(snapshot: SessionSnapshot): Promise<boolean> {
    const projectChanged = await this.projectFileService.ensureProjectSandbox(snapshot);
    const transcriptChanged = this.materializeTranscript(snapshot);
    return projectChanged || transcriptChanged;
  }

  private materializeTranscript(snapshot: SessionSnapshot): boolean {
    if (!snapshot.project) throw new Error("Project sandbox has not been initialized.");
    const path = this.transcriptStore.getTranscriptPath(
      snapshot.session.id,
      snapshot.project.rootPath,
    );
    if (snapshot.transcript?.path === path) return false;
    snapshot.transcript = {
      path,
      leafMessageUuid: snapshot.transcript?.leafMessageUuid,
    };
    return true;
  }

  private async recordTranscriptMessages(
    snapshot: SessionSnapshot,
    messages: SessionChatMessage[],
  ): Promise<void> {
    if (!snapshot.project || !snapshot.transcript) {
      throw new Error("Session transcript has not been initialized.");
    }

    const transcriptMessages = messages.map((message): TranscriptMessageInput => {
      const metadata: Record<string, unknown> = {};
      if (message.thought) metadata.thought = message.thought;
      if (message.progress !== undefined) metadata.progress = message.progress;
      if (message.approval) metadata.approval = message.approval;
      if (message.patch) metadata.patch = message.patch;
      if (message.threadId) metadata.threadId = message.threadId;

      return {
        uuid: message.id,
        role: message.role,
        kind: message.approval ? "approval" : "message",
        content: message.content,
        cwd: snapshot.project!.rootPath,
        threadId: message.approval?.threadId ?? message.threadId,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      };
    });

    const inserted = await this.transcriptStore.insertMessageChain({
      sessionId: snapshot.session.id,
      projectDir: snapshot.project.rootPath,
      cwd: snapshot.project.rootPath,
      messages: transcriptMessages,
    });
    snapshot.transcript.leafMessageUuid = inserted.at(-1)?.uuid;
  }

  private expirePendingApprovals(): boolean {
    let changed = false;
    for (const snapshot of this.requireData().sessions) {
      snapshot.messages = snapshot.messages.map((message) => {
        let next = message;
        if (message.approval) {
          changed = true;
          this.expiredApprovalMessageIds.add(message.id);
          next = this.toExpiredApprovalMessage(next);
        }
        if (message.patch && !message.patch.resolved) {
          changed = true;
          next = this.toExpiredPatchMessage(next);
        }
        return next;
      });
    }
    return changed;
  }

  private toExpiredPatchMessage(message: SessionChatMessage): SessionChatMessage {
    if (!message.patch || message.patch.resolved) return message;
    const expirationNotice = "该 Patch 审核请求已随应用重启失效，请重新提交指令。";
    return {
      ...message,
      content: message.content.includes(expirationNotice)
        ? message.content
        : `${message.content}\n\n${expirationNotice}`,
      patch: {
        ...message.patch,
        resolved: "rejected",
      },
    };
  }

  private toExpiredApprovalMessage(message: SessionChatMessage): SessionChatMessage {
    if (!message.approval) return message;
    const { approval: _, ...rest } = message;
    const expirationNotice = "该审批请求已随应用重启失效，请重新提交指令。";
    return {
      ...rest,
      content: message.content.includes(expirationNotice)
        ? message.content
        : `${message.content}\n\n${expirationNotice}`,
    };
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
      .map((item) => ({
        ...structuredClone(item.session),
        workspacePath: item.project?.rootPath,
      }));
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
