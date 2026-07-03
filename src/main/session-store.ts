import { cp, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
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
import {
  getSessionSandboxPath,
  isFlatWorkspaceSandboxPath,
  isLegacyProjectSandboxPath,
  type WorkspaceSessionIndexEntry,
  type WorkspaceSessionsIndex,
} from "@shared/workspace-meta";
import {
  getWorkspaceLabel,
  normalizeWorkspacePath,
  resolveWorkspacePath,
  sessionBelongsToWorkspace,
} from "@shared/workspace";
import { WorkspaceIndexStore } from "./workspace-index-store";

const storedSessionSchema = sessionSnapshotSchema;
const sessionFileSchema = z.object({
  version: z.literal(1),
  activeSessionId: z.string(),
  sessions: z.array(storedSessionSchema),
});

type SessionFile = z.infer<typeof sessionFileSchema>;

export class FileSessionStore {
  private data?: SessionFile;
  private writeQueue = Promise.resolve();
  private readonly projectsRootPath: string;
  private readonly projectFileService: ProjectFileService;
  private readonly generationJobsService: GenerationJobsService;
  private readonly exportHistoryService: ExportHistoryService;
  private readonly transcriptStore = new TranscriptStore();
  private readonly workspaceIndexStore = new WorkspaceIndexStore();
  private readonly expiredApprovalMessageIds = new Set<string>();

  constructor(private readonly filePath: string, projectRootPath?: string) {
    this.projectsRootPath = projectRootPath ?? join(dirname(filePath), "projects");
    this.projectFileService = new ProjectFileService(this.projectsRootPath);
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
      if (parsed.sessions.length === 0) {
        this.data = { ...parsed, activeSessionId: "" };
      } else if (!activeExists) {
        this.data = { ...parsed, activeSessionId: parsed.sessions[0].session.id };
      } else {
        this.data = parsed;
      }
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
    const activeSession = this.findActiveSession(data);
    return {
      sessions: this.listSummaries(data),
      activeSession: activeSession ? structuredClone(activeSession) : undefined,
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
      messages: [],
    };

    if (options?.rootPath) {
      const workspaceRoot = normalizeWorkspacePath(options.rootPath);
      snapshot.session.workspacePath = workspaceRoot;
      snapshot.project = {
        rootPath: getSessionSandboxPath(workspaceRoot, snapshot.session.id),
        artifacts: defaultProjectArtifacts.map((artifact) => ({ ...artifact })),
      };
    }

    await this.materializeProjectSandbox(snapshot);
    await this.recordTranscriptMessages(snapshot, snapshot.messages);
    data.sessions.unshift(snapshot);
    data.activeSessionId = snapshot.session.id;
    await this.persist();
    await this.syncWorkspacePersistence(snapshot, { active: true });
    return this.getBootstrap();
  }

  async openWorkspace(rootPath: string): Promise<SessionBootstrap> {
    const normalized = normalizeWorkspacePath(rootPath);
    await this.workspaceIndexStore.ensureProjectMeta(
      normalized,
      getWorkspaceLabel(normalized),
    );

    let index = await this.workspaceIndexStore.readSessionsIndex(normalized);
    if (!index) {
      index = await this.buildWorkspaceIndexFromGlobal(normalized);
    }

    if (index && index.sessions.length > 0) {
      await this.hydrateGlobalSessionsFromWorkspaceIndex(normalized, index);
      return this.selectSession(index.activeSessionId);
    }

    return this.createSession({ rootPath: normalized });
  }

  async listWorkspaceSessions(rootPath: string): Promise<SessionSummary[]> {
    const normalized = normalizeWorkspacePath(rootPath);
    let index = await this.workspaceIndexStore.readSessionsIndex(normalized);
    if (!index) {
      index = await this.buildWorkspaceIndexFromGlobal(normalized);
    }
    if (!index) return [];

    return index.sessions.map((entry) => ({
      id: entry.id,
      title: entry.title,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      slideCount: entry.slideCount,
      revision: entry.revision,
      workspacePath: normalized,
    }));
  }

  async migrateLegacySessionToWorkspace(
    sessionId: string,
    targetRootPath: string,
  ): Promise<SessionBootstrap> {
    const snapshot = this.findSession(sessionId);
    if (!snapshot.project) {
      throw new Error("Session does not have a project sandbox to migrate.");
    }

    const legacyPath = normalizeWorkspacePath(snapshot.project.rootPath);
    if (!isLegacyProjectSandboxPath(legacyPath, this.projectsRootPath)) {
      throw new Error("Session is not using a legacy projects/session-{id} sandbox.");
    }

    const normalizedTarget = normalizeWorkspacePath(targetRootPath);
    await mkdir(normalizedTarget, { recursive: true });
    const sessionSandbox = getSessionSandboxPath(normalizedTarget, sessionId);
    await mkdir(sessionSandbox, { recursive: true });
    await copyDirectoryMerge(legacyPath, sessionSandbox);

    snapshot.project.rootPath = sessionSandbox;
    snapshot.session.workspacePath = normalizedTarget;
    await this.materializeProjectSandbox(snapshot);
    await this.syncWorkspacePersistence(snapshot, { active: true });
    await this.persist();
    return this.getBootstrap();
  }

  async selectSession(sessionId: string): Promise<SessionBootstrap> {
    const data = this.requireData();
    const snapshot = this.findSession(sessionId);
    data.activeSessionId = sessionId;
    const workspaceRoot = this.getWorkspaceRoot(snapshot);
    if (workspaceRoot) {
      await this.workspaceIndexStore.setActiveSession(workspaceRoot, sessionId);
    }
    await this.persist();
    return this.getBootstrap();
  }

  async deleteSession(sessionId: string): Promise<SessionBootstrap> {
    const data = this.requireData();
    const index = data.sessions.findIndex((item) => item.session.id === sessionId);
    if (index === -1) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const removed = data.sessions[index];
    const workspaceRoot = this.getWorkspaceRoot(removed);
    data.sessions.splice(index, 1);
    if (data.sessions.length === 0) {
      data.activeSessionId = "";
    } else if (data.activeSessionId === sessionId) {
      data.activeSessionId = data.sessions[0].session.id;
    }
    if (workspaceRoot) {
      await this.workspaceIndexStore.removeSession(workspaceRoot, sessionId);
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
    await this.syncWorkspacePersistence(snapshot);
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
    await this.syncWorkspacePersistence(snapshot);
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
      await this.syncWorkspacePersistence(snapshot);
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
    await this.syncWorkspacePersistence(snapshot);
    return artifact;
  }

  private createInitialData(): SessionFile {
    return { version: 1, activeSessionId: "", sessions: [] };
  }

  private findActiveSession(data: SessionFile): SessionSnapshot | undefined {
    if (!data.activeSessionId) return undefined;
    return data.sessions.find((item) => item.session.id === data.activeSessionId);
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
    const migrated = await this.migrateFlatWorkspaceSandbox(snapshot);
    const projectChanged = await this.projectFileService.ensureProjectSandbox(snapshot);
    const transcriptChanged = this.materializeTranscript(snapshot);
    return migrated || projectChanged || transcriptChanged;
  }

  private async migrateFlatWorkspaceSandbox(snapshot: SessionSnapshot): Promise<boolean> {
    const project = snapshot.project;
    if (!project || !this.isWorkspaceBoundRoot(project.rootPath)) return false;
    if (!isFlatWorkspaceSandboxPath(project.rootPath, this.projectsRootPath)) return false;

    const workspaceRoot = normalizeWorkspacePath(project.rootPath);
    const sessionSandbox = getSessionSandboxPath(workspaceRoot, snapshot.session.id);
    const briefAtRoot = join(workspaceRoot, "brief.md");

    let hasFlatArtifacts = false;
    try {
      await stat(briefAtRoot);
      hasFlatArtifacts = true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }

    if (hasFlatArtifacts) {
      await mkdir(sessionSandbox, { recursive: true });
      await migrateFlatWorkspaceArtifacts(workspaceRoot, sessionSandbox);
    }

    project.rootPath = sessionSandbox;
    snapshot.session.workspacePath = workspaceRoot;
    return true;
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
      if (message.reasoning) metadata.reasoning = message.reasoning;
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
        workspacePath: this.getWorkspaceRoot(item),
      }));
  }

  private getWorkspaceRoot(snapshot: SessionSnapshot): string | undefined {
    const resolved = resolveWorkspacePath(
      {
        workspacePath: snapshot.session.workspacePath,
        projectRootPath: snapshot.project?.rootPath,
      },
      this.projectsRootPath,
    );
    if (!resolved || !snapshot.project?.rootPath) return undefined;
    return this.isWorkspaceBoundRoot(snapshot.project.rootPath) ? resolved : undefined;
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

  private isWorkspaceBoundRoot(rootPath: string): boolean {
    return !isLegacyProjectSandboxPath(
      normalizeWorkspacePath(rootPath),
      this.projectsRootPath,
    );
  }

  private async syncWorkspacePersistence(
    snapshot: SessionSnapshot,
    options?: { active?: boolean },
  ): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot(snapshot);
    if (!workspaceRoot) return;

    await this.workspaceIndexStore.ensureProjectMeta(
      workspaceRoot,
      getWorkspaceLabel(workspaceRoot),
    );
    await this.workspaceIndexStore.upsertSession(workspaceRoot, snapshot, {
      active: options?.active ?? this.requireData().activeSessionId === snapshot.session.id,
    });
  }

  private async buildWorkspaceIndexFromGlobal(
    rootPath: string,
  ): Promise<WorkspaceSessionsIndex | null> {
    const normalized = normalizeWorkspacePath(rootPath);
    const matches = this.requireData().sessions.filter((snapshot) =>
      sessionBelongsToWorkspace(
        {
          workspacePath: snapshot.session.workspacePath,
          projectRootPath: snapshot.project?.rootPath,
        },
        normalized,
        this.projectsRootPath,
      ),
    );
    if (matches.length === 0) return null;

    const latest = [...matches].sort((left, right) =>
      right.session.updatedAt.localeCompare(left.session.updatedAt),
    )[0];
    const index: WorkspaceSessionsIndex = {
      version: 1,
      activeSessionId: latest.session.id,
      sessions: matches.map((snapshot) => this.workspaceIndexStore.entryFromSnapshot(snapshot)),
    };

    await this.workspaceIndexStore.writeSessionsIndex(normalized, index);
    for (const snapshot of matches) {
      await this.workspaceIndexStore.upsertSession(normalized, snapshot, {
        active: snapshot.session.id === index.activeSessionId,
      });
    }
    return index;
  }

  private async hydrateGlobalSessionsFromWorkspaceIndex(
    rootPath: string,
    index: WorkspaceSessionsIndex,
  ): Promise<void> {
    const data = this.requireData();
    for (const entry of index.sessions) {
      if (data.sessions.some((item) => item.session.id === entry.id)) continue;

      const stored = await this.workspaceIndexStore.readSessionSnapshot(rootPath, entry.id);
      if (stored) {
        data.sessions.push(
          this.workspaceIndexStore.sessionFromWorkspaceSnapshot(stored, rootPath),
        );
        continue;
      }

      data.sessions.push(await this.rebuildSessionFromIndexEntry(entry, rootPath));
    }
  }

  private async rebuildSessionFromIndexEntry(
    entry: WorkspaceSessionIndexEntry,
    rootPath: string,
  ): Promise<SessionSnapshot> {
    const presentation = createSessionPresentation(entry.title);
    presentation.revision = entry.revision;
    const snapshot: SessionSnapshot = {
      session: {
        id: entry.id,
        title: entry.title,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        slideCount: entry.slideCount,
        revision: entry.revision,
        workspacePath: rootPath,
      },
      project: {
        rootPath: getSessionSandboxPath(rootPath, entry.id),
        artifacts: defaultProjectArtifacts.map((artifact) => ({ ...artifact })),
      },
      presentation,
      messages: [createWelcomeMessage(entry.title)],
      transcript: {
        path: entry.transcriptPath,
        leafMessageUuid: entry.leafMessageUuid,
      },
    };

    await this.materializeProjectSandbox(snapshot);
    await this.hydrateMessagesFromTranscript(snapshot);
    await this.workspaceIndexStore.upsertSession(rootPath, snapshot, { active: false });
    return snapshot;
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

async function migrateFlatWorkspaceArtifacts(workspaceRoot: string, sessionSandbox: string): Promise<void> {
  const reservedNames = new Set([
    ".agent-ppt",
    "sandboxes",
    "node_modules",
    ".git",
  ]);
  const artifactNames = new Set([
    "brief.md",
    "outline.md",
    "research",
    "slides",
    "design",
    "deck",
    "history",
    "transcripts",
  ]);

  for (const entry of await readdir(workspaceRoot, { withFileTypes: true })) {
    if (reservedNames.has(entry.name) || !artifactNames.has(entry.name)) continue;
    const sourcePath = join(workspaceRoot, entry.name);
    const targetPath = join(sessionSandbox, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryMerge(sourcePath, targetPath);
      continue;
    }
    if (entry.isFile()) {
      try {
        await stat(targetPath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          await cp(sourcePath, targetPath);
          continue;
        }
        throw error;
      }
    }
  }
}

async function copyDirectoryMerge(source: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryMerge(sourcePath, targetPath);
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      await stat(targetPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        await cp(sourcePath, targetPath);
        continue;
      }
      throw error;
    }
  }
}
