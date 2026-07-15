import React from "react";
import type { AgentQuestionResolved } from "@shared/agent-question";
import type { DisplayEvent } from "@shared/card-display-protocol";
import type { LayoutVisualMode } from "@shared/layout-preference";
import type { DesignSystemV1 } from "@design-system";
import { AgentQuestionCard } from "../../components/AgentQuestionCard";
import { LayoutChoiceCard } from "../../components/LayoutChoiceCard";
import {
  recordDisplayCardAction,
  useInteractionCardManager,
} from "../display-card-managers";
import type { CardHostId } from "../card-presentation-policy";

type QuestionEvent = Extract<DisplayEvent, { kind: "interaction.question-requested" }>;
type LayoutEvent = Extract<DisplayEvent, { kind: "interaction.layout-required" }>;

interface InteractionCardHostProps {
  host: Extract<CardHostId, "timeline" | "composer-before-input">;
  anchorMessageId?: string;
  selectedDesignSystem: DesignSystemV1;
  busy: boolean;
  onResolveQuestion: (event: QuestionEvent, resolved: AgentQuestionResolved) => void;
  onConfirmLayout: (
    event: LayoutEvent,
    mode: LayoutVisualMode,
    designSystem: DesignSystemV1,
  ) => void;
}

/** Renders only semantic interaction events owned by the interaction manager. */
export const InteractionCardHost: React.FC<InteractionCardHostProps> = ({
  host,
  anchorMessageId,
  selectedDesignSystem,
  busy,
  onResolveQuestion,
  onConfirmLayout,
}) => {
  const cards = useInteractionCardManager((state) => state.cards).filter((card) =>
    card.policy.host === host
    && (host !== "timeline" || card.event.scope.anchorMessageId === anchorMessageId)
    && (host !== "composer-before-input" || card.status === "active")
    && card.status !== "dismissed"
    && card.status !== "superseded"
  );

  return (
    <>
      {cards.map((card) => {
        const event = card.event;
        if (event.kind === "interaction.question-requested") {
          const resolved = card.status === "resolved"
            && card.lastAction?.actionId === "answer"
            ? card.lastAction.payload as AgentQuestionResolved
            : undefined;
          const question = event.payload.question;
          if (!question) return null;
          return (
            <AgentQuestionCard
              key={event.eventId}
              question={resolved ? { ...question, resolved } : question}
              disabled={busy || card.status !== "active"}
              onResolve={(answer) => {
                recordDisplayCardAction(event.eventId, "answer", answer, "resolved");
                onResolveQuestion(event, answer);
              }}
            />
          );
        }

        if (event.kind === "interaction.layout-required") {
          const actionPayload = card.lastAction?.payload as {
            mode?: LayoutVisualMode;
            designSystem?: DesignSystemV1;
          } | undefined;
          return (
            <LayoutChoiceCard
              key={event.eventId}
              slideCount={event.payload.slideCount}
              resolved={card.status === "resolved" ? "confirmed" : undefined}
              layoutMode={actionPayload?.mode}
              selectedDesignSystem={actionPayload?.designSystem ?? selectedDesignSystem}
              onConfirm={card.status === "active" && !busy
                ? (mode, designSystem) => {
                    recordDisplayCardAction(
                      event.eventId,
                      "confirm-layout",
                      { mode, designSystem },
                      "resolved",
                    );
                    onConfirmLayout(event, mode, designSystem);
                  }
                : undefined}
            />
          );
        }

        return null;
      })}
    </>
  );
};
