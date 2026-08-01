import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exportToPptx } from "../src/main/ppt-exporter";
import { DESIGN_PRESETS } from "../src/design-system";
import { createStarterPresentation } from "../src/shared/presentation-fixtures";
import type { Presentation, Slide } from "../src/shared/presentation";

function svgSlide(
  id: string,
  title: string,
  headline: string,
  sourcePath: string,
): Slide {
  const markup =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">`
    + `<rect width="1280" height="720" fill="#f8fafc"/>`
    + `<text x="80" y="120" font-family="sans-serif" font-size="48" fill="#0f172a">${headline}</text>`
    + `</svg>`;
  return {
    id,
    title,
    elements: [],
    visualSource: {
      kind: "svg",
      markup,
      width: 1280,
      height: 720,
      sha256: createHash("sha256").update(markup, "utf8").digest("hex"),
      sourcePath,
      resources: [],
    },
  };
}

function buildSamplePresentation(): Presentation {
  const presentation = createStarterPresentation();
  presentation.title = "Agent PPT 示例演示";
  presentation.revision = 1;
  presentation.designSystem = DESIGN_PRESETS.find((preset) => preset.id === "swiss-minimal")!.system;
  presentation.slides = [
    svgSlide("slide-1", "封面", "Agent PPT 示例演示", "slides/svg/slide-1.svg"),
    svgSlide("slide-2", "核心观点", "SVG-native 示例页", "slides/svg/slide-2.svg"),
  ];
  return presentation;
}

async function main(): Promise<void> {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const outputPath = resolve(projectRoot, "output", "sample-presentation.pptx");

  await mkdir(dirname(outputPath), { recursive: true });

  const presentation = buildSamplePresentation();

  await exportToPptx(presentation, {}, outputPath);

  console.log(`已生成示例 PPT：${outputPath}`);
  console.log(`标题：${presentation.title}`);
  console.log(`页数：${presentation.slides.length}`);
  console.log(
    `设计系统：${presentation.designSystem.visualStyle} · ${presentation.designSystem.colorScheme}`,
  );
}

main().catch((error) => {
  console.error("生成 PPT 失败：", error);
  process.exitCode = 1;
});
