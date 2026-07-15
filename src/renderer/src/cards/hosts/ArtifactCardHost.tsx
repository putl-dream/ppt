import React from "react";
import type { DisplayEvent } from "@shared/card-display-protocol";
import type { Presentation } from "@shared/presentation";
import { hasMeaningfulArtifactContent, isDefaultArtifactContent } from "@shared/project-artifact-state";
import { parseBriefFields, parseOutlineItems } from "@shared/project-artifacts";
import { BriefCard } from "../../components/BriefCard";
import { OutlineCard } from "../../components/OutlineCard";
import { DeckPreviewCard } from "../../components/DeckPreviewCard";
import { useProjectStore } from "../../components/project-store";
import {
  recordDisplayCardAction,
  useArtifactCardManager,
} from "../display-card-managers";

type ArtifactEvent = Extract<DisplayEvent, { kind: "artifact.ready" }>;

interface ArtifactCardHostProps {
  anchorMessageId?: string;
  presentation?: Presentation;
  busy: boolean;
  isExportingDeck?: boolean;
  onConfirmBrief: (event: ArtifactEvent) => void;
  onConfirmOutline: (event: ArtifactEvent) => void;
  onReviseOutline: (event: ArtifactEvent) => void;
  onOpenDeckPreview: () => void;
  onExportDeck: () => void;
}

/** Renders project artifacts selected by semantic artifact events. */
export const ArtifactCardHost: React.FC<ArtifactCardHostProps> = ({
  anchorMessageId,
  presentation,
  busy,
  isExportingDeck,
  onConfirmBrief,
  onConfirmOutline,
  onReviseOutline,
  onOpenDeckPreview,
  onExportDeck,
}) => {
  const project = useProjectStore((state) => state.activeProject);
  const cards = useArtifactCardManager((state) => state.cards).filter((card) =>
    card.event.scope.anchorMessageId === anchorMessageId
    && card.status !== "dismissed"
    && card.status !== "superseded"
  );

  return (
    <>
      {cards.map((card) => {
        const event = card.event;
        if (event.kind !== "artifact.ready") return null;
        const type = event.payload.artifactType;
        const resolved = card.status === "resolved" ? "confirmed" as const : undefined;

        if (type === "brief") {
          const content = project?.artifacts.brief.content ?? "";
          if (!hasMeaningfulArtifactContent("brief", content)) return null;
          return (
            <BriefCard
              key={event.eventId}
              fields={parseBriefFields(content, project?.name ?? "新演示文稿")}
              resolved={resolved}
              onConfirm={card.status === "active"
                ? () => {
                    recordDisplayCardAction(event.eventId, "approve", undefined, "resolved");
                    onConfirmBrief(event);
                  }
                : undefined}
            />
          );
        }

        if (type === "outline") {
          const content = project?.artifacts.outline.content ?? "";
          const items = parseOutlineItems(content);
          if (
            !hasMeaningfulArtifactContent("outline", content)
            || (items.length === 1 && isDefaultArtifactContent("outline", content))
          ) return null;
          return (
            <OutlineCard
              key={event.eventId}
              items={items}
              resolved={resolved}
              busy={busy}
              onConfirm={card.status === "active"
                ? () => {
                    recordDisplayCardAction(event.eventId, "approve", undefined, "resolved");
                    onConfirmOutline(event);
                  }
                : undefined}
              onRevise={card.status === "active"
                ? () => {
                    recordDisplayCardAction(event.eventId, "revise", undefined, "dismissed");
                    onReviseOutline(event);
                  }
                : undefined}
            />
          );
        }

        if (type === "deck" && presentation) {
          return (
            <DeckPreviewCard
              key={event.eventId}
              presentation={presentation}
              isExporting={isExportingDeck}
              resolved={resolved}
              onPreview={() => {
                recordDisplayCardAction(event.eventId, "preview", undefined, card.status);
                onOpenDeckPreview();
              }}
              onExport={() => {
                recordDisplayCardAction(event.eventId, "export", undefined, card.status);
                onExportDeck();
              }}
            />
          );
        }

        return null;
      })}
    </>
  );
};
