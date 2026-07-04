export const SLIDE_LAYOUTS = [
  "cover",
  "section",
  "concept",
  "comparison",
  "process",
  "architecture",
  "case",
  "summary",
  "toc",
  "quote",
  "image-grid",
] as const;

export type SlideLayoutType = (typeof SLIDE_LAYOUTS)[number];

export const CHROME_LAYOUTS = new Set<SlideLayoutType>(["cover", "section"]);

export const CONTENT_LAYOUTS = new Set<SlideLayoutType>([
  "concept",
  "comparison",
  "process",
  "architecture",
  "case",
  "summary",
  "toc",
  "quote",
  "image-grid",
]);
