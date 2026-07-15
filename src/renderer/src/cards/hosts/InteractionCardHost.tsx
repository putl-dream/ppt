import React from "react";
import type { AgentQuestion, AgentQuestionResolved } from "@shared/agent-question";
import type { InlineCardRef } from "@shared/inline-artifact-cards";
import type { LayoutVisualMode } from "@shared/layout-preference";
import type { DesignSystemV1 } from "@design-system";
import { AgentQuestionCard } from "../../components/AgentQuestionCard";
import { LayoutChoiceCard } from "../../components/LayoutChoiceCard";
import {
  setDisplayCardStatus,
  useInteractionCardManager,
} from "../display-card-managers";

interface InteractionCardHostProps {
  messageId: string;
  question?: AgentQuestion;
  inlineCards: InlineCardRef[];
  showLayoutCard: boolean;
  layoutSlideCount?: number;
  layoutMode?: LayoutVisualMode;
  selectedDesignSystem: DesignSystemV1;
  busy: boolean;
  onResolveQuestion: (messageId: string, resolved: AgentQuestionResolved) => void;
  onConfirmLayout: (
    messageId: string,
    mode: LayoutVisualMode,
    designSystem: DesignSystemV1,
  ) => void;
}

/** Owns user-decision cards; it does not render permissions or transaction reviews. */
export const InteractionCardHost: React.FC<InteractionCardHostProps> = ({
  messageId,
  question,
  inlineCards,
  showLayoutCard,
  layoutSlideCount,
  layoutMode,
  selectedDesignSystem,
  busy,
  onResolveQuestion,
  onConfirmLayout,
}) => {
  const managedCards = useInteractionCardManager((state) => state.cards);
  const managedQuestion = [...managedCards].reverse().find((card) =>
    card.status === "active"
    && card.event.kind === "interaction.question-requested"
    && card.event.scope.anchorMessageId === messageId
  );
  const managedLayout = [...managedCards].reverse().find((card) =>
    card.status === "active"
    && card.event.kind === "interaction.layout-required"
    && card.event.scope.anchorMessageId === messageId
  );
  const managedQuestionPayload = managedQuestion?.event.kind === "interaction.question-requested"
    ? managedQuestion.event.payload
    : undefined;
  const managedLayoutPayload = managedLayout?.event.kind === "interaction.layout-required"
    ? managedLayout.event.payload
    : undefined;
  const resolvedQuestion = managedQuestionPayload?.question ?? question;
  const layoutCard = inlineCards.find((card) => card.type === "layout");
  const shouldRenderLayout = Boolean(managedLayoutPayload) || Boolean(layoutCard && showLayoutCard);

  return (
    <>
      {resolvedQuestion ? (
        <AgentQuestionCard
          question={resolvedQuestion}
          disabled={busy}
          onResolve={(resolved) => {
            if (managedQuestion) setDisplayCardStatus(managedQuestion.event.eventId, "resolved");
            onResolveQuestion(messageId, resolved);
          }}
        />
      ) : null}

      {shouldRenderLayout ? (
        <LayoutChoiceCard
          slideCount={managedLayoutPayload?.slideCount ?? layoutSlideCount ?? 1}
          resolved={layoutCard?.resolved}
          layoutMode={layoutMode ?? layoutCard?.layoutMode}
          selectedDesignSystem={selectedDesignSystem}
          onConfirm={layoutCard?.resolved
            ? undefined
            : (mode, designSystem) => {
                if (managedLayout) setDisplayCardStatus(managedLayout.event.eventId, "resolved");
                onConfirmLayout(messageId, mode, designSystem);
              }}
        />
      ) : null}
    </>
  );
};
