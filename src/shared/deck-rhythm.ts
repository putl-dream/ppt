import type { Presentation } from "./presentation";
import type { SlideLayoutType } from "./slide-layouts";

export interface DeckRhythmIssue {
  slideId?: string;
  severity: "info" | "warning" | "error";
  message: string;
  fixHint?: string;
}

const DATA_OR_FLOW_LAYOUTS = new Set<SlideLayoutType>(["case", "process", "comparison"]);

export function validateDeckRhythm(presentation: Presentation): DeckRhythmIssue[] {
  const issues: DeckRhythmIssue[] = [];
  const slides = presentation.slides;
  const count = slides.length;

  if (count === 0) return issues;

  const layouts = slides.map((slide) => slide.layout as SlideLayoutType | undefined);

  if (!layouts.includes("cover")) {
    issues.push({
      severity: "warning",
      message: "Deck has no cover slide.",
      fixHint: "Add a cover page as the opening slide.",
    });
  }

  if (count >= 5 && !layouts.includes("summary")) {
    issues.push({
      severity: "warning",
      message: "Deck with 5+ slides has no summary slide.",
      fixHint: "Add a summary page to close the narrative arc.",
    });
  }

  if (count >= 8 && !layouts.includes("section")) {
    issues.push({
      severity: "warning",
      message: "Deck with 8+ slides has no section divider.",
      fixHint: "Insert a section page for chapter breathing room.",
    });
  }

  for (let i = 0; i < layouts.length - 2; i += 1) {
    const a = layouts[i];
    const b = layouts[i + 1];
    const c = layouts[i + 2];
    if (a && a === b && b === c) {
      issues.push({
        slideId: slides[i + 2]?.id,
        severity: "error",
        message: `Three consecutive slides use layout '${a}' (slides ${i + 1}–${i + 3}).`,
        fixHint: "Vary layout types; see ppt-layout/narrative-arc.md.",
      });
    }
  }

  const uniqueLayouts = new Set(layouts.filter(Boolean));
  const minDistinct = count >= 10 ? 5 : count >= 7 ? 4 : 0;
  if (minDistinct > 0 && uniqueLayouts.size < minDistinct) {
    issues.push({
      severity: "warning",
      message: `${count}-slide deck uses only ${uniqueLayouts.size} layout types (minimum ${minDistinct}).`,
      fixHint: "Introduce case, process, comparison, or section layouts.",
    });
  }

  if (count >= 7 && !layouts.some((layout) => layout && DATA_OR_FLOW_LAYOUTS.has(layout))) {
    issues.push({
      severity: "info",
      message: "Deck lacks a data or flow page (case/process/comparison).",
      fixHint: "Add at least one case or process slide for visual variety.",
    });
  }

  return issues;
}
