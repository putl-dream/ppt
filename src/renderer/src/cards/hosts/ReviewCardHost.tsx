import React from "react";
import type { DisplayEvent } from "@shared/card-display-protocol";
import { formatApprovalCommand } from "@shared/approval-command-display";
import { FileIcon } from "../../components/Icons";
import { PatchReviewCard } from "../../components/PatchReviewCard";
import {
  recordDisplayCardAction,
  useReviewCardManager,
} from "../display-card-managers";

type CommandProposalEvent = Extract<DisplayEvent, { kind: "review.command-proposal" }>;
type PatchEvent = Extract<DisplayEvent, { kind: "review.patch-ready" }>;

interface ReviewCardHostProps {
  anchorMessageId?: string;
  busy: boolean;
  onResolveApproval: (event: CommandProposalEvent, approved: boolean) => void;
  onResolvePatch: (event: PatchEvent, accepted: boolean) => void;
}

/** Renders revision-bound reviews from the review manager only. */
export const ReviewCardHost: React.FC<ReviewCardHostProps> = ({
  anchorMessageId,
  busy,
  onResolveApproval,
  onResolvePatch,
}) => {
  const cards = useReviewCardManager((state) => state.cards).filter((card) =>
    card.event.scope.anchorMessageId === anchorMessageId
    && card.status !== "dismissed"
    && card.status !== "superseded"
  );

  return (
    <>
      {cards.map((card) => {
        const event = card.event;
        if (event.kind === "review.patch-ready") {
          const accepted = card.lastAction?.actionId === "approve";
          return (
            <PatchReviewCard
              key={event.eventId}
              patch={{
                ...event.payload,
                resolved: card.status === "resolved"
                  ? (accepted ? "accepted" : "rejected")
                  : undefined,
              }}
              busy={busy}
              onAccept={() => {
                recordDisplayCardAction(event.eventId, "approve", undefined, "resolved");
                onResolvePatch(event, true);
              }}
              onReject={() => {
                recordDisplayCardAction(event.eventId, "deny", undefined, "resolved");
                onResolvePatch(event, false);
              }}
            />
          );
        }

        if (event.kind !== "review.command-proposal") return null;
        const approval = event.payload;
        if (card.status !== "active") return null;
        const resolve = (approved: boolean) => {
          recordDisplayCardAction(
            event.eventId,
            approved ? "approve" : "deny",
            undefined,
            approved ? "resolved" : "dismissed",
          );
          onResolveApproval(event, approved);
        };

        return (
          <div className="approval-card" key={event.eventId}>
            <div className="approval-card-title"><span>📋 待审核的排版更新</span></div>
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
              <button disabled={busy} onClick={() => resolve(false)} className="btn-reject">
                拒绝变更
              </button>
              <button disabled={busy} onClick={() => resolve(true)} className="btn-apply">
                确认执行修改
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
};
