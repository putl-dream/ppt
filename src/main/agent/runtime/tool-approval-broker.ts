import type { AgentServiceEvent, AgentServiceEventListener } from "../service";
import type { ToolApprovalHandler, ToolApprovalRequest } from "./permission-check";
import { formatToolApprovalDetail } from "./format-tool-approval";

type PendingApproval = {
  runId: string;
  resolve: (approved: boolean) => void;
};

export class ToolApprovalBroker {
  private readonly pending = new Map<string, PendingApproval>();

  createHandler(
    runId: string,
    emit: AgentServiceEventListener,
  ): ToolApprovalHandler {
    return async (request: ToolApprovalRequest) => {
      const approvalId = crypto.randomUUID();
      emit({
        type: "tool-approval-waiting",
        approvalId,
        toolName: request.toolName,
        reason: request.reason,
        detail: formatToolApprovalDetail(request.toolName, request.args),
        message: `工具 ${request.toolName} 需要您的确认`,
      });

      return await new Promise<boolean>((resolve) => {
        this.pending.set(approvalId, { runId, resolve });
      });
    };
  }

  resolve(approvalId: string, approved: boolean): boolean {
    const entry = this.pending.get(approvalId);
    if (!entry) return false;
    this.pending.delete(approvalId);
    entry.resolve(approved);
    return true;
  }

  cancelForRun(runId: string): void {
    for (const [approvalId, entry] of this.pending) {
      if (entry.runId !== runId) continue;
      this.pending.delete(approvalId);
      entry.resolve(false);
    }
  }
}
