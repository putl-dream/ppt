import { createHash, randomUUID } from "node:crypto";
import { DEFAULT_DESIGN_SYSTEM } from "../design-system";
import {
  SVG_PAGE_HEIGHT,
  SVG_PAGE_WIDTH,
  type Presentation,
  type Slide,
  type SlideNarrative,
  type SvgPageVisualSource,
} from "./presentation";

/** Minimal valid 1280×720 SVG page for tests and sample scripts. */
export function createMinimalSvgMarkup(title = "Agent PPT"): string {
  const safeTitle = title
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">`,
    `<rect width="1280" height="720" fill="#0f172a"/>`,
    `<text x="640" y="360" fill="#f8fafc" font-size="64" text-anchor="middle"`,
    ` font-family="Arial, sans-serif">${safeTitle}</text>`,
    `</svg>`,
  ].join("");
}

export function createSvgVisualSource(input?: {
  markup?: string;
  sourcePath?: string;
  title?: string;
}): SvgPageVisualSource {
  const markup = input?.markup ?? createMinimalSvgMarkup(input?.title ?? "Agent PPT");
  return {
    kind: "svg",
    markup,
    width: SVG_PAGE_WIDTH,
    height: SVG_PAGE_HEIGHT,
    sha256: createHash("sha256").update(markup, "utf8").digest("hex"),
    sourcePath: input?.sourcePath ?? "slides/svg/P01.svg",
    resources: [],
  };
}

export function createSvgTestSlide(input?: {
  id?: string;
  title?: string;
  markup?: string;
  sourcePath?: string;
  narrative?: SlideNarrative;
  speakerNotes?: string;
}): Slide {
  const title = input?.title ?? "Opening";
  return {
    id: input?.id ?? randomUUID(),
    title,
    ...(input?.speakerNotes !== undefined ? { speakerNotes: input.speakerNotes } : {}),
    visualSource: createSvgVisualSource({
      markup: input?.markup,
      sourcePath: input?.sourcePath,
      title,
    }),
    ...(input?.narrative ? { narrative: input.narrative } : {}),
  };
}

export function createStarterPresentation(): Presentation {
  return {
    id: randomUUID(),
    title: "Untitled presentation",
    revision: 0,
    designSystem: DEFAULT_DESIGN_SYSTEM,
    slides: [createSvgTestSlide({ title: "Opening" })],
  };
}
