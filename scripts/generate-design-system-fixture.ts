import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { exportToPptx } from "../src/main/ppt-exporter";
import type { DesignTokensV1 } from "../src/shared/design-tokens";
import type { Presentation, Slide } from "../src/shared/presentation";

const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function tokens(overrides: Partial<DesignTokensV1>): DesignTokensV1 {
  return {
    version: 1,
    palette: "business-blue",
    fontMood: "formal",
    shapeLanguage: "cards",
    backgroundStyle: "clean",
    motif: "none",
    density: "standard",
    imageTreatment: "plain",
    chartStyle: "minimal",
    ...overrides,
  };
}

function visualSlide(
  id: string,
  title: string,
  designTokens: DesignTokensV1,
  chartType: "bar" | "h-bar" | "timeline" | "kpi-tower",
): Slide {
  return {
    id,
    title,
    layout: "concept",
    designTokens,
    elements: [
      {
        id: `${id}-lead`,
        type: "text",
        x: 120,
        y: 170,
        width: 440,
        height: 110,
        text: "One contract\nThree renderers",
        fontSize: 28,
        bold: true,
      },
      {
        id: `${id}-body`,
        type: "text",
        x: 120,
        y: 310,
        width: 440,
        height: 120,
        text: "Colors, typography, background, image treatment and chart defaults resolve once per slide.",
        fontSize: 20,
      },
      {
        id: `${id}-image`,
        type: "image",
        x: 120,
        y: 470,
        width: 440,
        height: 120,
        url: TINY_PNG_DATA_URL,
        borderRadius: 0,
        asset: { description: "Image treatment fixture" },
      },
      {
        id: `${id}-chart`,
        type: "chart",
        x: 650,
        y: 180,
        width: 470,
        height: 380,
        chartType,
        data: {
          labels: ["Research", "Story", "Visual", "Export"],
          values: [62, 78, 91, 86],
        },
      },
    ],
  };
}

const presentation: Presentation = {
  id: "design-system-fixture",
  title: "Resolved Design System Fixture",
  revision: 1,
  theme: "nordic",
  palette: "cyan",
  slides: [
    visualSlide(
      "warm-grid",
      "Warm paper · grid · report",
      tokens({
        palette: "warm-paper",
        fontMood: "editorial",
        shapeLanguage: "editorial",
        backgroundStyle: "grid",
        imageTreatment: "framed",
        chartStyle: "report",
      }),
      "h-bar",
    ),
    visualSlide(
      "tech-dashboard",
      "Tech dark · dashboard",
      tokens({
        palette: "tech-dark",
        fontMood: "technical",
        shapeLanguage: "geometric",
        backgroundStyle: "dark",
        imageTreatment: "plain",
        chartStyle: "dashboard",
      }),
      "kpi-tower",
    ),
    visualSlide(
      "blue-editorial",
      "Blue gradient · editorial",
      tokens({
        palette: "business-blue",
        fontMood: "minimal",
        shapeLanguage: "annotation",
        backgroundStyle: "gradient",
        imageTreatment: "masked",
        chartStyle: "editorial",
      }),
      "timeline",
    ),
  ],
};

const outputPath = resolve(process.argv[2] ?? "artifacts/design-system-fixture.pptx");
await mkdir(dirname(outputPath), { recursive: true });
await exportToPptx(
  presentation,
  { theme: presentation.theme ?? "nordic", palette: presentation.palette ?? "cyan" },
  outputPath,
);
console.log(outputPath);
