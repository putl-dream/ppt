import React from "react";

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
  const description = [
    `工具 ${approval.toolName} 请求授权`,
    approval.reason,
    approval.detail,
  ].filter(Boolean).join("；");

  return (
    <section
      className="tool-approval-gate"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={`tool-approval-title-${approval.approvalId}`}
      aria-describedby={`tool-approval-detail-${approval.approvalId}`}
    >
      <div className="tool-approval-gate-heading">
        <span className="tool-approval-gate-kicker">流程已暂停</span>
        <strong id={`tool-approval-title-${approval.approvalId}`}>需要工具权限</strong>
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
          拒绝并停止
        </button>
        <button
          type="button"
          className="tool-approval-gate-btn tool-approval-gate-btn--allow"
          onClick={() => onResolve(approval.approvalId, true)}
        >
          允许并继续
        </button>
      </div>
    </section>
  );
};
