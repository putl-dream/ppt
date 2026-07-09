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
  if (CHROME_LAYOUTS.has(slide.layout ?? "")) return false;
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
