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
}) => (
  <div className="tool-approval-overlay" role="dialog" aria-labelledby="tool-approval-title">
    <div className="tool-approval-overlay-card">
      <div className="tool-approval-overlay-header">
        <span className="tool-approval-overlay-icon" aria-hidden="true">🔐</span>
        <div>
          <h3 id="tool-approval-title" className="tool-approval-overlay-title">
            需要您的授权
          </h3>
          <p className="tool-approval-overlay-subtitle">
            工具操作 · {approval.toolName}
          </p>
        </div>
      </div>

      <p className="tool-approval-overlay-reason">{approval.reason}</p>

      {approval.detail && (
        <pre className="tool-approval-overlay-detail">{approval.detail}</pre>
      )}

      <div className="tool-approval-overlay-actions">
        <button
          type="button"
          className="tool-approval-overlay-btn tool-approval-overlay-btn--deny"
          onClick={() => onResolve(approval.approvalId, false)}
        >
          拒绝
        </button>
        <button
          type="button"
          className="tool-approval-overlay-btn tool-approval-overlay-btn--allow"
          onClick={() => onResolve(approval.approvalId, true)}
        >
          允许
        </button>
      </div>
    </div>
  </div>
);
