import React from "react";
import {
  formatAgentToolApprovalDetail,
  getAgentToolDisplayCopy,
} from "@shared/agent-activity-display";

export interface PendingToolApproval {
  approvalId: string;
  toolName: string;
  reason: string;
  detail: string;
}

interface ToolApprovalOverlayProps {
  approval: PendingToolApproval;
  onResolve: (approvalId: string, approved: boolean) => void;
}

export const ToolApprovalOverlay: React.FC<ToolApprovalOverlayProps> = ({
  approval,
  onResolve,
}) => {
  const action = getAgentToolDisplayCopy(approval.toolName).action;
  const detail = formatAgentToolApprovalDetail(approval.detail);
  const description = [
    `即将${action}`,
    approval.reason,
    detail,
  ].filter(Boolean).join("\n");

  return (
    <section
      className="tool-approval-gate"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={`tool-approval-title-${approval.approvalId}`}
      aria-describedby={`tool-approval-detail-${approval.approvalId}`}
    >
      <div className="tool-approval-gate-heading">
        <span className="tool-approval-gate-kicker">等待确认</span>
        <strong id={`tool-approval-title-${approval.approvalId}`}>需要你的授权</strong>
      </div>
      <div
        id={`tool-approval-detail-${approval.approvalId}`}
        className="tool-approval-gate-description"
        title={description}
      >
        {description}
      </div>
      <div className="tool-approval-gate-actions">
        <button
          type="button"
          className="tool-approval-gate-btn tool-approval-gate-btn--deny"
          onClick={() => onResolve(approval.approvalId, false)}
          autoFocus
        >
          暂不允许
        </button>
        <button
          type="button"
          className="tool-approval-gate-btn tool-approval-gate-btn--allow"
          onClick={() => onResolve(approval.approvalId, true)}
        >
          允许继续
        </button>
      </div>
    </section>
  );
};
