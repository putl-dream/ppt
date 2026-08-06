import type { Presentation } from "@shared/presentation";

export function presentationUsesSvgPages(presentation: Presentation): boolean {
  return presentation.slides.some((slide) => slide.visualSource?.kind === "svg");
}
