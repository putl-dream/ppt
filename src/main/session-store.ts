import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { presentationSchema, type Presentation } from "@shared/presentation";
import {
  createDefaultSessionTitle,
  createSessionPresentation,
  type ProjectArtifactStatus,
  sessionChatMessageSchema,
  sessionSnapshotSchema,
  type SessionBootstrap,
  type SessionChatMessage,
  type SessionSnapshot,
  type SessionSummary,
} from "@shared/session";
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
import { defaultProjectArtifacts } from "@shared/project";
import type { CreateSessionOptions } from "@shared/ipc";
import {
  getSessionSandboxPath,
  isLegacyProjectSandboxPath,
} from "@shared/workspace-meta";
import {
  compareSessionsByActivity,
  getWorkspaceLabel,
  normalizeWorkspacePath,
  resolveWorkspacePath,
} from "@shared/workspace";
import { writeTextFileAtomic } from "./agent/persistence/atomic-json-file";
import {
  appendReasoningChunk,
  appendStep,
  appendToolStart,
  compactActivityTraceForPersistence,
  finishTool,
  markTraceComplete,
  upsertTaskGraphTrace,
  type AgentActivityItem,
} from "@shared/agent-activity";
import { agentTaskNodeSchema } from "@shared/agent-task-graph";
import { formatPublicErrorMessage } from "@shared/agent-activity-display";
import { ConversationDatabase } from "./conversation-database";
import type { AgentRunResult } from "@shared/ipc";

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
  readonly conversationDatabase: ConversationDatabase;
  private readonly projectsRootPath: string;
  private readonly projectFileService: ProjectFileService;
  private readonly generationJobsService: GenerationJobsService;
  private readonly exportHistoryService: ExportHistoryService;

  constructor(private readonly filePath: string, projectRootPath?: string) {
    this.projectsRootPath = projectRootPath ?? join(dirname(filePath), "projects");
    this.conversationDatabase = new ConversationDatabase(filePath);
    this.projectFileService = new ProjectFileService(this.projectsRootPath);
    this.generationJobsService = new GenerationJobsService(this.projectFileService);
    this.exportHistoryService = new ExportHistoryService(this.projectFileService);
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const stored = this.conversationDatabase.loadState();
    this.data = sessionFileSchema.parse({
      version: 1,
      activeSessionId: stored.activeSessionId,
      sessions: stored.sessions,
    });
    await this.materializeProjectSandboxes();
    await this.persist();
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



  async createSession(options?: CreateSessionOptions): Promise<SessionBootstrap> {
    const data = this.requireData();
    const title = options?.title ?? createDefaultSessionTitle(data.sessions.length + 1);
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
    data.sessions.unshift(snapshot);
    data.activeSessionId = snapshot.session.id;
    await this.persist();
    await this.syncWorkspacePersistence(snapshot, { active: true });
    return this.getBootstrap();
  }

  async openWorkspace(rootPath: string): Promise<SessionBootstrap> {
    const normalized = normalizeWorkspacePath(rootPath);
    const matches = this.requireData().sessions
      .filter((snapshot) => this.getWorkspaceRoot(snapshot) === normalized)
      .sort((left, right) => compareSessionsByActivity(left.session, right.session));
    if (matches.length > 0) return this.selectSession(matches[0].session.id);
    return this.createSession({ rootPath: normalized });
  }

  close(): void {
    this.conversationDatabase.close();
  }

  async listWorkspaceSessions(rootPath: string): Promise<SessionSummary[]> {
    const normalized = normalizeWorkspacePath(rootPath);
    return this.requireData().sessions
      .filter((snapshot) => this.getWorkspaceRoot(snapshot) === normalized)
      .sort((left, right) => compareSessionsByActivity(left.session, right.session))
      .map((snapshot) => ({ ...structuredClone(snapshot.session), workspacePath: normalized }));
  }

  async selectSession(sessionId: string): Promise<SessionBootstrap> {
    const data = this.requireData();
    const snapshot = this.findSession(sessionId);
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
      data.activeSessionId = "";
    } else if (data.activeSessionId === sessionId) {
      data.activeSessionId = data.sessions[0].session.id;
    }
    await this.persist();
    return this.getBootstrap();
  }

  async savePresentation(sessionId: string, presentation: Presentation): Promise<void> {
    const snapshot = this.findSession(sessionId);
    const validatedPresentation = presentationSchema.parse(structuredClone(presentation));
    snapshot.presentation = validatedPresentation;
    snapshot.session = {
      ...this.toSummary(
        snapshot.session.id,
        snapshot.session.createdAt,
        new Date().toISOString(),
        validatedPresentation,
      ),
      lastMessageAt: snapshot.session.lastMessageAt,
    };
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
    const parsedMessages = sessionChatMessageSchema.array().parse(
      structuredClone(messages).map((message) => ({
        ...message,
        activityTrace: compactActivityTraceForPersistence(message.activityTrace),
      })),
    );
    const messagesChanged = this.messagesChanged(snapshot.messages, parsedMessages);
    snapshot.messages = parsedMessages;
    snapshot.session.updatedAt = new Date().toISOString();
    if (messagesChanged && this.hasConversationMessages(parsedMessages)) {
      snapshot.session.lastMessageAt = new Date().toISOString();
    }
    await this.persist();
  }

  /**
   * Main-process authoritative completion. Renderer state is never required for
   * the final assistant message to become durable.
   */
  async finalizeAgentRunMessage(
    sessionId: string,
    runId: string,
    result: AgentRunResult,
  ): Promise<void> {
    const snapshot = this.findSession(sessionId);
    let message = [...snapshot.messages].reverse().find(
      (item) => item.role === "assistant" && item.threadId === runId,
    );
    if (!message) {
      message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        threadId: runId,
      };
      snapshot.messages.push(message);
    }

    const trace = this.projectRunTrace(runId);
    message.activityTrace = trace.length > 0
      ? compactActivityTraceForPersistence(markTraceComplete(trace))
      : undefined;

    if (result.status === "chat") {
      message.content = result.message;
      message.threadId = result.threadId ?? runId;
      message.question = result.question;
    } else if (result.status === "approval-required") {
      message.content = "已提出排版更新方案，请在下方审核后应用。";
      message.threadId = result.approval.threadId;
      message.approval = result.approval;
    } else if (result.status === "rejected") {
      message.content = "已放弃排版变更提案。";
    } else {
      message.content = "已根据确认的大纲生成并应用演示文稿。";
    }

    const now = new Date().toISOString();
    snapshot.session.updatedAt = now;
    snapshot.session.lastMessageAt = now;
    await this.persist();
  }

  async failAgentRunMessage(sessionId: string, runId: string, error: string): Promise<void> {
    const snapshot = this.findSession(sessionId);
    let message = [...snapshot.messages].reverse().find(
      (item) => item.role === "assistant" && item.threadId === runId,
    );
    if (!message) {
      message = { id: crypto.randomUUID(), role: "assistant", content: "", threadId: runId };
      snapshot.messages.push(message);
    }
    const interrupted = /aborted|中断|取消/i.test(error);
    message.content = interrupted
      ? "会话已中断。"
      : `本次处理未完成：${formatPublicErrorMessage(
          error,
          "处理请求时遇到问题，请稍后重试。",
        )}`;
    const trace = this.projectRunTrace(runId);
    message.activityTrace = trace.length > 0
      ? compactActivityTraceForPersistence(markTraceComplete(
          trace,
          interrupted ? "denied" : "failed",
        ))
      : undefined;
    const now = new Date().toISOString();
    snapshot.session.updatedAt = now;
    snapshot.session.lastMessageAt = now;
    await this.persist();
  }

  /**
   * Keep a completed assistant message in sync with late task-board updates
   * emitted by a long-lived teammate after the lead run has returned.
   */
  async refreshAgentRunTrace(sessionId: string, runId: string): Promise<void> {
    const snapshot = this.findSession(sessionId);
    const message = [...snapshot.messages].reverse().find(
      (item) => item.role === "assistant" && item.threadId === runId,
    );
    if (!message) return;

    const trace = this.projectRunTrace(runId);
    message.activityTrace = trace.length > 0
      ? compactActivityTraceForPersistence(markTraceComplete(trace))
      : undefined;
    snapshot.session.updatedAt = new Date().toISOString();
    await this.persist();
  }

  private projectRunTrace(runId: string): AgentActivityItem[] {
    let trace: AgentActivityItem[] = [];
    for (const event of this.conversationDatabase.listRunEvents(runId)) {
      if (event.visibility !== "user_visible") continue;
      const payload = event.payload;
      if (event.kind === "reasoning_chunk" && typeof payload.chunk === "string") {
        trace = appendReasoningChunk(
          trace,
          payload.chunk,
          typeof payload.modelStep === "number" ? payload.modelStep : 0,
        );
      } else if (event.kind === "tool_started" && typeof payload.toolName === "string") {
        trace = appendToolStart(
          trace,
          payload.toolName,
          typeof payload.message === "string" ? payload.message : `正在调用 ${payload.toolName}`,
        );
      } else if (event.kind === "tool_finished" && typeof payload.toolName === "string") {
        trace = finishTool(
          trace,
          payload.toolName,
          typeof payload.message === "string" ? payload.message : `${payload.toolName} 已完成`,
        );
      } else if (
        (event.kind === "stage_started" || event.kind === "workflow_progress")
        && typeof payload.message === "string"
      ) {
        trace = appendStep(trace, payload.message, "done");
      } else if (event.kind === "task_graph_updated") {
        const parsedTasks = agentTaskNodeSchema.array().safeParse(payload.tasks);
        if (!parsedTasks.success) continue;
        trace = upsertTaskGraphTrace(trace, {
          tasks: parsedTasks.data,
          goal: typeof payload.goal === "string" || payload.goal === null
            ? payload.goal
            : null,
        });
      }
    }
    return trace;
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

  private async materializeProjectSandbox(snapshot: SessionSnapshot): Promise<boolean> {
    const projectChanged = await this.projectFileService.ensureProjectSandbox(snapshot);
    await this.syncWorkspacePersistence(snapshot);
    return projectChanged;
  }

  private messagesChanged(
    before: SessionChatMessage[],
    after: SessionChatMessage[],
  ): boolean {
    return JSON.stringify(before) !== JSON.stringify(after);
  }

  private hasConversationMessages(messages: SessionChatMessage[]): boolean {
    return messages.some((message) => message.role === "user");
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
      .sort((a, b) => compareSessionsByActivity(a.session, b.session))
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
    void options;
    const projectId = this.conversationDatabase.ensureProject(
      workspaceRoot,
      getWorkspaceLabel(workspaceRoot),
    );
    await writeTextFileAtomic(
      join(workspaceRoot, ".agent-ppt-project.json"),
      `${JSON.stringify({
        version: 1,
        projectId,
        title: getWorkspaceLabel(workspaceRoot),
      }, null, 2)}\n`,
    );
  }

  private async persist(): Promise<void> {
    const state = structuredClone(this.requireData());
    const write = this.writeQueue.catch(() => undefined).then(async () => {
      this.conversationDatabase.replaceState({
        activeSessionId: state.activeSessionId,
        sessions: state.sessions,
      });
    });
    this.writeQueue = write;
    await write;
  }
}
