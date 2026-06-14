import type { Presentation } from "./presentation";
import type { PresentationCommand } from "./commands";
import type { AgentExecutionStrategy, AgentModelSelection, AgentModelSettings } from "./agent";
import type { SessionBootstrap, SessionChatMessage } from "./session";

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
}

export interface AgentOutlineRequest {
  threadId: string;
  message: string;
  outline?: PresentationOutline;
  missingInformation: string[];
  model?: AgentModelSelection;
  executionStrategy?: AgentExecutionStrategy;
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
    type: "text-delta";
    delta: string;
  };

export type AgentRunResult =
  | { status: "chat"; message: string }
  | { status: "outline-required"; outlineRequest: AgentOutlineRequest }
  | { status: "approval-required"; approval: AgentApprovalRequest }
  | { status: "completed"; presentation: Presentation }
  | { status: "rejected"; presentation: Presentation };

export interface DesktopApi {
  getSessionState(): Promise<SessionBootstrap>;
  createSession(): Promise<SessionBootstrap>;
  selectSession(sessionId: string): Promise<SessionBootstrap>;
  deleteSession(sessionId: string): Promise<SessionBootstrap>;
  saveSessionMessages(sessionId: string, messages: SessionChatMessage[]): Promise<void>;
  getPresentation(): Promise<Presentation>;
  startAgentRun(
    request: string,
    model?: AgentModelSettings,
    executionStrategy?: AgentExecutionStrategy,
    runId?: string,
  ): Promise<AgentRunResult>;
  continueAgentRun(threadId: string, request: string, runId?: string): Promise<AgentRunResult>;
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
