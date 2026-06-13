import type { Presentation } from "./presentation";
import type { PresentationCommand } from "./commands";
import type { AgentExecutionStrategy, AgentModelSettings } from "./agent";

export interface AgentApprovalRequest {
  threadId: string;
  summary: string;
  commands: PresentationCommand[];
}

export type AgentRunResult =
  | { status: "approval-required"; approval: AgentApprovalRequest }
  | { status: "completed"; presentation: Presentation }
  | { status: "rejected"; presentation: Presentation };

export interface DesktopApi {
  getPresentation(): Promise<Presentation>;
  startAgentRun(
    request: string,
    model?: AgentModelSettings,
    executionStrategy?: AgentExecutionStrategy,
  ): Promise<AgentRunResult>;
  resumeAgentRun(threadId: string, approved: boolean): Promise<AgentRunResult>;
  undo(): Promise<Presentation>;
  redo(): Promise<Presentation>;
  executeCommand(command: PresentationCommand): Promise<Presentation>;
}
