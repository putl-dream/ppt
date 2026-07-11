import type { ProjectStageId } from "./project";
import {
  createDefaultBriefMarkdown,
  createDefaultProjectDesignSystem,
  createDefaultOutlineMarkdown,
  createDefaultResearchMarkdown,
  parseBriefFields,
  parseProjectDesignSystem,
  parseOutlineItems,
  parseResearchNotes,
  serializeBriefMarkdown,
  serializeProjectDesignSystem,
} from "./project-artifacts";

const DEFAULT_SLIDES_STORYBOARD = JSON.stringify(
  [
    {
      title: "封面页",
      layout: "cover",
      keyPoints: ["智能硬件市场推广", "主讲人: AI 助手"],
      quote: "",
    },
  ],
  null,
  2,
);

const DEFAULT_DECK_SNAPSHOT = JSON.stringify(
  {
    title: "新演示文稿",
    slides: [],
  },
  null,
  2,
);

function outlineStructureKey(content: string): string {
  const items = parseOutlineItems(content);
  return JSON.stringify(
    items.map((item) => ({
      title: item.title,
      pages: item.pages,
      points: item.points,
    })),
  );
}

function researchStructureKey(content: string): string {
  const notes = parseResearchNotes(content);
  return JSON.stringify(
    notes.map((note) => ({
      source: note.source,
      quote: note.quote,
    })),
  );
}

function designStructureKey(content: string): string {
  return JSON.stringify(parseProjectDesignSystem(content));
}

function slidesStructureKey(content: string): string {
  try {
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return content.trim();
    return JSON.stringify(
      parsed.map((slide) => ({
        title: slide?.title ?? "",
        layout: slide?.layout ?? "",
        keyPoints: slide?.keyPoints ?? [],
        quote: slide?.quote ?? "",
      })),
    );
  } catch {
    return content.trim();
  }
}

function deckStructureKey(content: string): string {
  try {
    const parsed = JSON.parse(content) as { title?: string; slides?: unknown[] };
    return JSON.stringify({
      title: parsed.title ?? "新演示文稿",
      slideCount: Array.isArray(parsed.slides) ? parsed.slides.length : 0,
    });
  } catch {
    return content.trim();
  }
}

export function isDefaultArtifactContent(stage: ProjectStageId, content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return true;

  switch (stage) {
    case "brief":
      return serializeBriefMarkdown(parseBriefFields(trimmed))
        === serializeBriefMarkdown(parseBriefFields(createDefaultBriefMarkdown()));
    case "outline":
      return outlineStructureKey(trimmed)
        === outlineStructureKey(createDefaultOutlineMarkdown());
    case "research":
      return researchStructureKey(trimmed)
        === researchStructureKey(createDefaultResearchMarkdown());
    case "design":
      return designStructureKey(trimmed)
        === designStructureKey(serializeProjectDesignSystem(createDefaultProjectDesignSystem()));
    case "slides":
      return slidesStructureKey(trimmed) === slidesStructureKey(DEFAULT_SLIDES_STORYBOARD);
    case "deck":
      return deckStructureKey(trimmed) === deckStructureKey(DEFAULT_DECK_SNAPSHOT);
    default:
      return false;
  }
}

export function hasMeaningfulArtifactContent(
  stage: ProjectStageId,
  content: string | undefined,
): boolean {
  if (!content?.trim()) return false;
  return !isDefaultArtifactContent(stage, content);
}
