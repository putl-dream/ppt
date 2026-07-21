import { rasterDataImageSourceSchema, type Presentation } from "./presentation";
import type { PresentationCommand } from "./commands";
import type { AgentExecutionStrategy, AgentModelSettings } from "./agent";
import type { AgentQuestion } from "./agent-question";
import type { AgentGatewayConfig } from "./agent-gateway-config";
import type { AgentStepLimits } from "./agent-step-limits";
import type { AgentTaskNode } from "./agent-task-graph";
import type { TeammateProgressEvent } from "./teammate-progress";
import { layoutChoiceSchema } from "./layout-preference";
import { z } from "zod";
import type {
  ProjectArtifact,
  ProjectArtifactStatus,
  SessionBootstrap,
  SessionChatMessage,
  SessionSummary,
} from "./session";
import type { TokenUsageStats } from "./token-usage";
import type { ConversationEventPage } from "./conversation-events";
import {
  leanGenerationModeSchema,
  type LeanRunMetrics,
} from "./lean-mode-contract";
import type {
  AgentApprovalRequest,
  DisplayEvent,
  PersistedDisplayCard,
} from "./card-display-protocol";
import type {
  AppLogEntry,
  AppLogLevel,
  LogManagerSettings,
  LogManagerStatus,
  RendererLogReport,
} from "./logging";

export interface CreateSessionOptions {
  rootPath?: string;
  title?: string;
}

export type { AgentApprovalRequest } from "./card-display-protocol";

export interface AgentEditorContext {
  currentSlideId?: string;
  selectedElementIds: string[];
}

export const agentEditorContextSchema = z.object({
  currentSlideId: z.string().optional(),
  selectedElementIds: z.array(z.string()),
});

export const agentAttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  mimeType: z.string().optional(),
});

export const agentRunRequestSchema = z.object({
  prompt: z.string().trim().min(1),
  sessionId: z.string().trim().min(1),
  editorContext: agentEditorContextSchema.optional(),
  attachments: z.array(agentAttachmentSchema).optional(),
  layoutChoice: layoutChoiceSchema.optional(),
  generationMode: leanGenerationModeSchema.optional().default("agent"),
});

export type AgentAttachment = z.infer<typeof agentAttachmentSchema>;
export type AgentRunRequest = z.infer<typeof agentRunRequestSchema>;

export type AgentStreamEvent = (
  | { runId: string; type: "request-status"; message: string; progress: number }
  | { runId: string; type: "workflow-progress"; message: string; progress: number }
  | { runId: string; type: "text-chunk"; chunk: string; source?: "message" | "tool-summary" }
  | { runId: string; type: "thinking-chunk"; chunk: string; modelStep?: number }
  | { runId: string; type: "stage-started"; message: string; stage: string }
  | { runId: string; type: "tool-started"; message: string; toolName: string }
  | { runId: string; type: "tool-finished"; message: string; toolName: string }
  | { runId: string; type: "tool-validation-failed"; message: string; toolName: string; error: string }
  | { runId: string; type: "approval-waiting"; message: string }
  | {
      runId: string;
      type: "tool-approval-waiting";
      message: string;
      approvalId: string;
      toolName: string;
      reason: string;
      detail: string;
    }
  | {
      runId: string;
      type: "task-graph-updated";
      message: string;
      tasks: AgentTaskNode[];
      goal?: string | null;
    }
  | ({ runId: string } & TeammateProgressEvent)
  | { runId: string; type: "display-event"; event: DisplayEvent }
) & { sessionId?: string };

type AgentRunResultDisplay = {
  displayEvents?: DisplayEvent[];
  leanMetrics?: LeanRunMetrics;
};

export type AgentRunResult = (
  | { status: "chat"; message: string; threadId?: string; question?: AgentQuestion }
  | { status: "approval-required"; approval: AgentApprovalRequest }
  | { status: "completed"; presentation: Presentation }
  | { status: "rejected"; presentation?: Presentation }
) & AgentRunResultDisplay;

export interface AgentInboxPollResult {
  hasMessages: boolean;
  count: number;
  preview: string;
  types: string[];
}

export type WindowThemeMode = "light" | "dark" | "cyan" | "orange" | "system";

export interface ProjectArtifactReadResult {
  path: string;
  type: "file" | "directory";
  content?: string;
  entries?: string[];
}

export interface ArtifactDiff {
  path: string;
  before: string;
  after: string;
  changed: boolean;
  unifiedDiff: string;
}

export interface ProjectArtifactWriteResult {
  path: string;
  changed: boolean;
  changedArtifactId?: string;
  staleArtifactIds: string[];
}

export interface DesktopApi {
  getSessionState(): Promise<SessionBootstrap>;
  getTokenUsageStats(): Promise<TokenUsageStats>;
  getLogManagerStatus(): Promise<LogManagerStatus>;
  getRecentLogs(limit?: number, minimumLevel?: AppLogLevel): Promise<AppLogEntry[]>;
  updateLogManagerSettings(patch: Partial<LogManagerSettings>): Promise<LogManagerSettings>;
  clearLogs(): Promise<number>;
  openLogDirectory(): Promise<boolean>;
  reportRendererLog(report: RendererLogReport): void;
  createSession(options?: CreateSessionOptions): Promise<SessionBootstrap>;
  openWorkspace(rootPath: string): Promise<SessionBootstrap>;
  listWorkspaceSessions(rootPath: string): Promise<SessionSummary[]>;
  selectSession(sessionId: string): Promise<SessionBootstrap>;
  deleteSession(sessionId: string): Promise<SessionBootstrap>;
  saveSessionMessages(sessionId: string, messages: SessionChatMessage[]): Promise<void>;
  saveSessionDisplayCards(sessionId: string, cards: PersistedDisplayCard[]): Promise<void>;
  loadConversationEvents(sessionId: string, cursor?: number, limit?: number): Promise<ConversationEventPage>;
  listProjectArtifacts(sessionId: string): Promise<ProjectArtifact[]>;
  readProjectArtifact(
    sessionId: string,
    artifactIdOrPath: string,
  ): Promise<ProjectArtifactReadResult>;
  writeProjectArtifact(
    sessionId: string,
    relativePath: string,
    content: string,
  ): Promise<ProjectArtifactWriteResult>;
  getProjectArtifactDiff(
    sessionId: string,
    relativePath: string,
    nextContent: string,
  ): Promise<ArtifactDiff>;
  markProjectArtifactStatus(
    sessionId: string,
    artifactId: string,
    status: ProjectArtifactStatus,
  ): Promise<ProjectArtifact>;
  getPresentation(): Promise<Presentation>;
  startAgentRun(
    request: AgentRunRequest,
    model?: AgentModelSettings,
    executionStrategy?: AgentExecutionStrategy,
    stepLimits?: AgentStepLimits,
    gatewayConfig?: AgentGatewayConfig,
    runId?: string,
  ): Promise<AgentRunResult>;
  continueAgentRun(
    threadId: string,
    request: AgentRunRequest,
    model?: AgentModelSettings,
    stepLimits?: AgentStepLimits,
    gatewayConfig?: AgentGatewayConfig,
    runId?: string,
  ): Promise<AgentRunResult>;
  onAgentStream(listener: (event: AgentStreamEvent) => void): () => void;
  resumeAgentRun(sessionId: string, threadId: string, approved: boolean): Promise<AgentRunResult>;
  undo(): Promise<Presentation>;
  redo(): Promise<Presentation>;
  executeCommand(command: PresentationCommand): Promise<Presentation>;
  exportPresentation(
    presentation: Presentation,
    options: ExportPresentationOptions,
  ): Promise<string | null>;
  openExportFolder(filePath: string): Promise<boolean>;
  selectDirectory(defaultPath?: string): Promise<string | null>;
  setWindowThemeMode(themeMode: WindowThemeMode): Promise<"light" | "dark">;
  cancelAgentRun(runId: string): Promise<boolean>;
  cancelAgentSession(sessionId: string): Promise<boolean>;
  resolveToolApproval(runId: string, approvalId: string, approved: boolean): Promise<boolean>;
  pollLeadInbox(sessionId: string): Promise<AgentInboxPollResult>;
}

export const exportPresentationOptionsSchema = z.object({
  logoUrl: rasterDataImageSourceSchema.nullable().optional(),
  /** Explicit human approval for assets whose commercial license is not yet verified. */
  allowUnverifiedAssets: z.boolean().optional(),
}).strict();

export type ExportPresentationOptions = z.infer<typeof exportPresentationOptionsSchema>;

export interface DeckExportResult {
  filePath: string;
  slideCount: number;
}
