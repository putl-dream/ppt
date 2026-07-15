import React from "react";
import type { AgentApprovalRequest } from "@shared/ipc";
import { formatApprovalCommand } from "@shared/approval-command-display";
import { FileIcon } from "../../components/Icons";
import {
  setDisplayCardStatus,
  useReviewCardManager,
} from "../display-card-managers";

interface ReviewCardHostProps {
  messageId: string;
  approval?: AgentApprovalRequest;
  busy: boolean;
  onResolveApproval: (
    approved: boolean,
    approval: AgentApprovalRequest,
    messageId: string,
  ) => void;
}

/** Owns revision-bound transaction review cards. */
export const ReviewCardHost: React.FC<ReviewCardHostProps> = ({
  messageId,
  approval,
  busy,
  onResolveApproval,
}) => {
  const managedCards = useReviewCardManager((state) => state.cards);
  if (!approval) return null;
  const managedReview = [...managedCards].reverse().find((card) =>
    card.status === "active"
    && card.event.kind === "review.command-proposal"
    && card.event.scope.anchorMessageId === messageId
  );
  const resolve = (approved: boolean) => {
    if (managedReview) {
      setDisplayCardStatus(managedReview.event.eventId, approved ? "resolved" : "dismissed");
    }
    onResolveApproval(approved, approval, messageId);
  };

  return (
    <div className="approval-card">
      <div className="approval-card-title">
        <span>📋 待审核的排版更新</span>
      </div>
      <p className="approval-summary">{approval.summary}</p>
      {approval.risk ? (
        <p className="approval-summary">
          风险等级：{approval.risk === "high" ? "高" : approval.risk === "medium" ? "中" : "低"}
        </p>
      ) : null}
      {approval.diff ? (
        <p className="approval-summary">
          影响范围：{approval.diff.affectedSlideIds.length} 页，新增元素 {approval.diff.elementChanges.addedCount} 个，删除元素 {approval.diff.elementChanges.removedCount} 个，更新元素 {approval.diff.elementChanges.updatedCount} 个
        </p>
      ) : null}
      {approval.assumptions?.length ? (
        <p className="approval-summary">默认假设：{approval.assumptions.join("；")}</p>
      ) : null}

      <div className="approval-commands-list">
        {approval.commands.map((command) => {
          const display = formatApprovalCommand(command);
          return (
            <div key={command.id} className="approval-command-item">
              <FileIcon size={12} className="cmd-icon" />
              <span className="cmd-type">{display.label}</span>
              {display.detail ? <span className="cmd-val">{display.detail}</span> : null}
            </div>
          );
        })}
      </div>

      <div className="approval-buttons">
        <button
          disabled={busy}
          onClick={() => resolve(false)}
          className="btn-reject"
        >
          拒绝变更
        </button>
        <button
          disabled={busy}
          onClick={() => resolve(true)}
          className="btn-apply"
        >
          确认执行修改
        </button>
      </div>
    </div>
  );
};
