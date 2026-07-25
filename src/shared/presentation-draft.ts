import type { Presentation, Slide } from "./presentation";
import { isLayoutCard, isLayoutGeneratedShape } from "./layout-shape-utils";

const CHROME_LAYOUTS = new Set(["cover", "section"]);

function slideHasLayoutCards(slide: Slide): boolean {
  return slide.elements.some(isLayoutCard);
}

function slideHasLayoutGeneratedElements(slide: Slide): boolean {
  return slide.elements.some((element) => {
    if (isLayoutGeneratedShape(element)) return true;
    return element.type === "image" && Boolean(element.imageSlot);
  });
}

function slideHasBodyText(slide: Slide): boolean {
  return slide.elements.some((element) => element.type === "text" && element.text.trim().length > 0);
}

export function slideNeedsLayoutChoice(slide: Slide): boolean {
  if (slide.visualSource?.kind === "svg") return false;
  if (CHROME_LAYOUTS.has(slide.layout ?? "")) return false;
  // A chosen grammar/design variant is durable evidence that this slide has
  // already entered the design workflow. Targeted typography or spacing fixes
  // may legitimately leave no generated cards/shapes, so element heuristics
  // alone must not send an edited deck back to the initial layout-choice gate.
  if (
    slide.grammarVariant
    || slide.designOverride
    || slide.slideVariant
    || slide.sceneRef
  ) return false;
  return slideHasBodyText(slide)
    && !slideHasLayoutCards(slide)
    && !slideHasLayoutGeneratedElements(slide);
}

/** True when deck has content slides that have not been through applyLayout yet. */
export function presentationNeedsLayoutChoice(presentation: Presentation | undefined): boolean {
  if (!presentation || presentation.slides.length === 0) return false;
  return presentation.slides.some((slide) => slideNeedsLayoutChoice(slide));
}

export function countSlidesNeedingLayout(presentation: Presentation | undefined): number {
  if (!presentation) return 0;
  return presentation.slides.filter((slide) => slideNeedsLayoutChoice(slide)).length;
}
