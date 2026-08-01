import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { exportToPptx } from "../src/main/ppt-exporter";
import {
  DEFAULT_DESIGN_SYSTEM,
  type SlideDesignOverride,
} from "../src/design-system";
import type { Presentation, Slide } from "../src/shared/presentation";

function svgSlide(
  id: string,
  title: string,
  designOverride: SlideDesignOverride,
  accent: string,
): Slide {
  const markup =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">`
    + `<rect width="1280" height="720" fill="${accent}"/>`
    + `<text x="80" y="120" font-family="sans-serif" font-size="40" fill="#ffffff">${title}</text>`
    + `</svg>`;
  return {
    id,
    title,
    layout: "concept",
    designOverride,
    elements: [],
    visualSource: {
      kind: "svg",
      markup,
      width: 1280,
      height: 720,
      sha256: createHash("sha256").update(markup, "utf8").digest("hex"),
      sourcePath: `slides/svg/${id}.svg`,
      resources: [],
    },
  };
}

const presentation: Presentation = {
  id: "design-system-fixture",
  title: "Resolved Design System Fixture",
  revision: 1,
  designSystem: DEFAULT_DESIGN_SYSTEM,
  slides: [
    svgSlide(
      "warm-grid",
      "Warm paper · grid · report",
      {
        palette: "warm-paper",
        fontMood: "editorial",
        shapeLanguage: "editorial",
        backgroundStyle: "grid",
        imageTreatment: "framed",
        chartStyle: "report",
      },
      "#92400e",
    ),
    svgSlide(
      "tech-dashboard",
      "Tech dark · dashboard",
      {
        palette: "tech-dark",
        fontMood: "technical",
        shapeLanguage: "geometric",
        backgroundStyle: "dark",
        imageTreatment: "plain",
        chartStyle: "dashboard",
      },
      "#0f172a",
    ),
    svgSlide(
      "blue-editorial",
      "Blue gradient · editorial",
      {
        palette: "business-blue",
        fontMood: "minimal",
        shapeLanguage: "annotation",
        backgroundStyle: "gradient",
        imageTreatment: "masked",
        chartStyle: "editorial",
      },
      "#1d4ed8",
    ),
  ],
};

const outputPath = resolve(process.argv[2] ?? "artifacts/design-system-fixture.pptx");
await mkdir(dirname(outputPath), { recursive: true });
await exportToPptx(presentation, {}, outputPath);
console.log(outputPath);
