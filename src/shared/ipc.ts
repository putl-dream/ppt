import type { Presentation } from "./presentation";
import type { PresentationCommand } from "./commands";
import type { AgentExecutionStrategy, AgentModelSelection, AgentModelSettings } from "./agent";
import type {
  ProjectArtifact,
  ProjectArtifactStatus,
  SessionBootstrap,
  SessionChatMessage,
} from "./session";

export interface PresentationOutline {
  title: string;
  audience?: string;
  objective?: string;
  slides: Array<{
    title: string;
    keyPoints: string[];
  }>;
}

export interface AgentApprovalRequest {
  threadId: string;
  summary: string;
  commands: PresentationCommand[];
  risk?: "low" | "medium" | "high";
  assumptions?: string[];
  diff?: {
    titleChanged: boolean;
    oldTitle: string;
    newTitle: string;
    themeChanged: boolean;
    slidesAddedCount: number;
    slidesRemovedCount: number;
    affectedSlideIds: string[];
    elementChanges: {
      addedCount: number;
      removedCount: number;
      updatedCount: number;
    };
  };
  preview?: Presentation;
}

export interface AgentOutlineRequest {
  threadId: string;
  message: string;
  outline?: PresentationOutline;
  missingInformation: string[];
  model?: AgentModelSelection;
  executionStrategy?: AgentExecutionStrategy;
}

export interface AgentEditorContext {
  currentSlideId?: string;
  selectedElementIds: string[];
}

export type AgentStreamEvent =
  | {
    runId: string;
    type: "request-status";
    message: string;
    progress: number;
  }
  | {
    runId: string;
    type: "workflow-progress";
    message: string;
    progress: number;
  }
  | {
    runId: string;
    type: "text-chunk";
    chunk: string;
  };

export type AgentRunResult =
  | { status: "chat"; message: string }
  | { status: "outline-required"; outlineRequest: AgentOutlineRequest }
  | { status: "approval-required"; approval: AgentApprovalRequest }
  | { status: "completed"; presentation: Presentation }
  | { status: "rejected"; presentation: Presentation };

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
  createSession(): Promise<SessionBootstrap>;
  selectSession(sessionId: string): Promise<SessionBootstrap>;
  deleteSession(sessionId: string): Promise<SessionBootstrap>;
  saveSessionMessages(sessionId: string, messages: SessionChatMessage[]): Promise<void>;
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
    request: string,
    model?: AgentModelSettings,
    executionStrategy?: AgentExecutionStrategy,
    runId?: string,
    editorContext?: AgentEditorContext,
  ): Promise<AgentRunResult>;
  continueAgentRun(
    threadId: string,
    request: string,
    runId?: string,
    editorContext?: AgentEditorContext,
  ): Promise<AgentRunResult>;
  confirmAgentOutline(threadId: string, runId?: string): Promise<AgentRunResult>;
  onAgentStream(listener: (event: AgentStreamEvent) => void): () => void;
  resumeAgentRun(threadId: string, approved: boolean): Promise<AgentRunResult>;
  undo(): Promise<Presentation>;
  redo(): Promise<Presentation>;
  executeCommand(command: PresentationCommand): Promise<Presentation>;
  exportPresentation(
    presentation: Presentation,
    options: ExportPresentationOptions,
  ): Promise<string | null>;
}

export interface ExportPresentationOptions {
  theme: string;
  palette: string;
  logoUrl?: string | null;
}
