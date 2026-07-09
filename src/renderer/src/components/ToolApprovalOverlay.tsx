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
    <div className="tool-approval-overlay" role="dialog" aria-label="工具权限申请">
      <div className="tool-approval-overlay-card">
        <div className="tool-approval-overlay-description" title={description}>
          {description}
        </div>
        <button
          type="button"
          className="tool-approval-overlay-btn tool-approval-overlay-btn--allow"
          onClick={() => onResolve(approval.approvalId, true)}
        >
          同意
        </button>
        <button
          type="button"
          className="tool-approval-overlay-btn tool-approval-overlay-btn--deny"
          onClick={() => onResolve(approval.approvalId, false)}
        >
          不同意
        </button>
      </div>
    </div>
  );
};
