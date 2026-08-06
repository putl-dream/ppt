import {
  createDefaultBriefMarkdown,
  createDefaultOutlineMarkdown,
  createDefaultResearchMarkdown,
  parseBriefFields,
  parseOutlineItems,
  parseResearchNotes,
  serializeBriefMarkdown,
} from "./project-artifacts";

export type OptionalProjectReferenceId = "brief" | "outline" | "research";

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

export function isDefaultArtifactContent(
  artifact: OptionalProjectReferenceId,
  content: string,
): boolean {
  const trimmed = content.trim();
  if (!trimmed) return true;

  switch (artifact) {
    case "brief":
      return (
        serializeBriefMarkdown(parseBriefFields(trimmed)) ===
        serializeBriefMarkdown(parseBriefFields(createDefaultBriefMarkdown()))
      );
    case "outline":
      return outlineStructureKey(trimmed) === outlineStructureKey(createDefaultOutlineMarkdown());
    case "research":
      return (
        researchStructureKey(trimmed) === researchStructureKey(createDefaultResearchMarkdown())
      );
  }
}

export function hasMeaningfulArtifactContent(
  artifact: OptionalProjectReferenceId,
  content: string | undefined,
): boolean {
  if (!content?.trim()) return false;
  return !isDefaultArtifactContent(artifact, content);
}
