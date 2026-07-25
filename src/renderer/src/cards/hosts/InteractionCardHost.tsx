import React, { useMemo } from "react";
import type { AgentQuestionResolved } from "@shared/agent-question";
import type { DisplayEvent } from "@shared/card-display-protocol";
import type { LayoutChoice } from "@shared/layout-preference";
import {
  DEFAULT_DESIGN_SYSTEM,
  type DesignSystemV2,
} from "@design-system";
import { parseBriefFields } from "@shared/project-artifacts";
import {
  matchVisualStyleFromText,
  resolveDesignPlan,
} from "@shared/design-recommendation";
import { AgentQuestionCard } from "../../components/AgentQuestionCard";
import { LayoutChoiceCard } from "../../components/LayoutChoiceCard";
import { useProjectStore } from "../../components/project-store";
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
  selectedDesignSystem: DesignSystemV2;
  busy: boolean;
  onResolveQuestion: (event: QuestionEvent, resolved: AgentQuestionResolved) => void;
  onConfirmLayout: (
    event: LayoutEvent,
    choice: LayoutChoice,
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
  const briefContent = useProjectStore(
    (state) => state.activeProject?.artifacts.brief.content,
  );
  const designCandidate = useMemo(() => {
    const brief = parseBriefFields(briefContent ?? "");
    const selectedDiffersFromDefault =
      JSON.stringify(selectedDesignSystem) !== JSON.stringify(DEFAULT_DESIGN_SYSTEM);
    const namedStyle = matchVisualStyleFromText(brief.style);
    return resolveDesignPlan({
      communicationContract: {
        audience: brief.audience,
        objective: brief.objective,
        desiredOutcome: brief.desiredAction,
        coreMessage: brief.coreMessage,
        deliveryContext: brief.presentationContext,
        afterUse: brief.afterUse,
      },
      sourceText: `${brief.title} ${brief.style}`,
      ...(namedStyle || selectedDiffersFromDefault
        ? {
            visualStyle: namedStyle ?? selectedDesignSystem.visualStyle,
            argumentMode: selectedDesignSystem.argumentMode,
            readingMode: selectedDesignSystem.readingMode,
            colorScheme: selectedDesignSystem.colorScheme,
          }
        : {}),
    });
  }, [briefContent, selectedDesignSystem]);

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
          const actionPayload = card.lastAction?.payload as LayoutChoice | undefined;
          return (
            <LayoutChoiceCard
              key={event.eventId}
              slideCount={event.payload.slideCount}
              candidate={designCandidate}
              resolvedChoice={card.status === "resolved" ? actionPayload : undefined}
              onConfirm={card.status === "active" && !busy
                ? (choice) => {
                    recordDisplayCardAction(
                      event.eventId,
                      "confirm-layout",
                      choice,
                      "resolved",
                    );
                    onConfirmLayout(event, choice);
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
