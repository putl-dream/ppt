import React from "react";
import {
  ToolApprovalOverlay,
  type PendingToolApproval,
} from "../../components/ToolApprovalOverlay";

interface PermissionCardHostProps {
  approval?: PendingToolApproval | null;
  onResolve?: (approvalId: string, approved: boolean) => void;
}

/** Dedicated blocking host for run-bound permission elevation. */
export const PermissionCardHost: React.FC<PermissionCardHostProps> = ({
  approval,
  onResolve,
}) => approval && onResolve
  ? <ToolApprovalOverlay approval={approval} onResolve={onResolve} />
  : null;
