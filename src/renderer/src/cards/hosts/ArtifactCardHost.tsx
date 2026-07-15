import React from "react";
import type { Presentation } from "@shared/presentation";
import type { InlineCardRef } from "@shared/inline-artifact-cards";
import type { BriefFields, OutlineItem } from "@shared/project-artifacts";
import { BriefCard } from "../../components/BriefCard";
import { OutlineCard } from "../../components/OutlineCard";
import { DeckPreviewCard } from "../../components/DeckPreviewCard";
import { useArtifactCardManager } from "../display-card-managers";

interface ArtifactCardHostProps {
  messageId: string;
  inlineCards: InlineCardRef[];
  briefFields?: BriefFields;
  outlineItems?: OutlineItem[];
  presentation?: Presentation;
  busy: boolean;
  isExportingDeck?: boolean;
  onConfirmBrief: (messageId: string) => void;
  onConfirmOutline: (messageId: string) => void;
  onReviseOutline: (messageId: string) => void;
  onOpenDeckPreview: () => void;
  onExportDeck: () => void;
}

/** Owns cards derived from project artifacts and Presentation state. */
export const ArtifactCardHost: React.FC<ArtifactCardHostProps> = ({
  messageId,
  inlineCards,
  briefFields,
  outlineItems,
  presentation,
  busy,
  isExportingDeck,
  onConfirmBrief,
  onConfirmOutline,
  onReviseOutline,
  onOpenDeckPreview,
  onExportDeck,
}) => {
  const managedCards = useArtifactCardManager((state) => state.cards);
  const managedArtifact = [...managedCards].reverse().find((card) =>
    card.status === "active"
    && card.event.kind === "artifact.ready"
    && card.event.scope.anchorMessageId === messageId
  );
  const managedArtifactPayload = managedArtifact?.event.kind === "artifact.ready"
    ? managedArtifact.event.payload
    : undefined;
  const managedInlineType = managedArtifactPayload?.artifactType === "patch"
    ? undefined
    : managedArtifactPayload?.artifactType;
  const refs = managedInlineType
    && !inlineCards.some((card) => card.type === managedInlineType)
    ? [...inlineCards, { type: managedInlineType } as InlineCardRef]
    : inlineCards;

  return (
    <>
    {refs.map((card) => {
      if (card.type === "brief" && briefFields) {
        return (
          <BriefCard
            key={`${messageId}-brief`}
            fields={briefFields}
            resolved={card.resolved}
            onConfirm={card.resolved ? undefined : () => onConfirmBrief(messageId)}
          />
        );
      }

      if (card.type === "outline" && outlineItems?.length) {
        return (
          <OutlineCard
            key={`${messageId}-outline`}
            items={outlineItems}
            resolved={card.resolved}
            busy={busy}
            onConfirm={card.resolved ? undefined : () => onConfirmOutline(messageId)}
            onRevise={card.resolved ? undefined : () => onReviseOutline(messageId)}
          />
        );
      }

      if (card.type === "deck" && presentation) {
        return (
          <DeckPreviewCard
            key={`${messageId}-deck`}
            presentation={presentation}
            isExporting={isExportingDeck}
            resolved={card.resolved}
            onPreview={onOpenDeckPreview}
            onExport={onExportDeck}
          />
        );
      }

      return null;
    })}
    </>
  );
};
