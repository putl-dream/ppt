import type { Presentation } from "./presentation";
import type { PresentationCommand } from "./commands";
import type { AgentExecutionStrategy, AgentModelSelection, AgentModelSettings } from "./agent";
import type { DeckGenerationJob } from "./deck-persistence";
import type { StoryboardSlideSpec } from "./storyboard";
import { z } from "zod";
import type {
  ProjectArtifact,
  ProjectArtifactStatus,
  SessionBootstrap,
  SessionChatMessage,
} from "./session";
import { projectStageIds } from "./project";

export interface CreateSessionOptions {
  rootPath?: string;
  title?: string;
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

export interface AgentEditorContext {
  currentSlideId?: string;
  selectedElementIds: string[];
}

export const agentIntentSchema = z.enum([
  "chat",
  "generate-artifact",
  "revise-artifact",
  "generate-deck",
  "revise-deck",
]);

export const agentStageSchema = z.enum(projectStageIds);

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
  intent: agentIntentSchema,
  stage: agentStageSchema,
  targetArtifactId: z.string().optional(),
  targetPath: z.string().optional(),
  referencedArtifactIds: z.array(z.string()).optional(),
  editorContext: agentEditorContextSchema.optional(),
  attachments: z.array(agentAttachmentSchema).optional(),
});

export type AgentIntent = z.infer<typeof agentIntentSchema>;
export type AgentStage = z.infer<typeof agentStageSchema>;
export type AgentAttachment = z.infer<typeof agentAttachmentSchema>;
export type AgentRunRequest = z.infer<typeof agentRunRequestSchema>;

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
  }
  | {
    runId: string;
    type: "stage-started";
    message: string;
    stage: string;
  }
  | {
    runId: string;
    type: "artifact-read";
    message: string;
    path: string;
  }
  | {
    runId: string;
    type: "artifact-diff-ready";
    message: string;
    path: string;
  }
  | {
    runId: string;
    type: "tool-started";
    message: string;
    toolName: string;
  }
  | {
    runId: string;
    type: "tool-finished";
    message: string;
    toolName: string;
  }
  | {
    runId: string;
    type: "approval-waiting";
    message: string;
  }
  | {
    runId: string;
    type: "deck-job-started";
    jobId: string;
    totalBatches: number;
    message: string;
  }
  | {
    runId: string;
    type: "deck-batch-started";
    jobId: string;
    batchIndex: number;
    totalBatches: number;
    message: string;
  }
  | {
    runId: string;
    type: "deck-batch-validated";
    jobId: string;
    batchIndex: number;
    errorCount: number;
    warningCount: number;
    message: string;
  }
  | {
    runId: string;
    type: "deck-job-progress";
    jobId: string;
    completedBatches: number;
    totalBatches: number;
    status: DeckGenerationJob["status"];
    message: string;
  }
  | {
    runId: string;
    type: "deck-job-finished";
    jobId: string;
    status: DeckGenerationJob["status"];
    message: string;
  };

export type AgentRunResult =
  | { status: "chat"; message: string; threadId?: string }
  | { status: "artifact-patch-required"; patch: AgentArtifactPatchRequest }
  | { status: "approval-required"; approval: AgentApprovalRequest }
  | { status: "completed"; presentation: Presentation }
  | { status: "artifact-updated"; write: ProjectArtifactWriteResult }
  | { status: "rejected"; presentation?: Presentation };

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

export interface AgentArtifactPatchRequest {
  threadId: string;
  targetPath: string;
  summary: string;
  before: string;
  after: string;
  diff: ArtifactDiff;
  changedArtifactId?: string;
  staleArtifactIds: string[];
  risk?: "low" | "medium" | "high";
}

export interface DesktopApi {
  getSessionState(): Promise<SessionBootstrap>;
  createSession(options?: CreateSessionOptions): Promise<SessionBootstrap>;
  openWorkspace(rootPath: string): Promise<SessionBootstrap>;
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
    request: AgentRunRequest,
    model?: AgentModelSettings,
    executionStrategy?: AgentExecutionStrategy,
    runId?: string,
  ): Promise<AgentRunResult>;
  continueAgentRun(
    threadId: string,
    request: AgentRunRequest,
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
  selectDirectory(defaultPath?: string): Promise<string | null>;
  cancelAgentRun(runId: string): Promise<boolean>;
  getDeckGenerationStatus(sessionId: string): Promise<DeckGenerationStatus | null>;
  resumeDeckGeneration(
    sessionId: string,
    jobId?: string,
    model?: AgentModelSettings,
    executionStrategy?: AgentExecutionStrategy,
    runId?: string,
  ): Promise<AgentRunResult>;
}

export interface ExportPresentationOptions {
  theme: string;
  palette: string;
  logoUrl?: string | null;
}

/** 数据层：一批 slides 生成完成后的结果（与文件导出解耦） */
export interface DeckGenerationResult {
  presentation: Presentation;
  batchIndex: number;
  done: boolean;
}

/** 文件层：Presentation 导出为外部文件后的结果 */
export interface DeckExportResult {
  filePath: string;
  slideCount: number;
}

export interface DeckGenerationStatus {
  job: DeckGenerationJob | null;
  storyboard: StoryboardSlideSpec[];
  doneSlides: number;
  pendingSlides: number;
  failedSlides: number;
}
