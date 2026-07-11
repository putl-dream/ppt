import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exportToPptx } from "../src/main/ppt-exporter";
import { CommandBus } from "../src/shared/commands";
import { createStarterPresentation } from "../src/shared/presentation";
import { DESIGN_PRESETS } from "../src/design-system";

const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function buildSamplePresentation() {
  const bus = new CommandBus(createStarterPresentation());
  const coverSlideId = bus.getSnapshot().slides[0].id;

  bus.executeMany([
    {
      id: crypto.randomUUID(),
      type: "set-presentation-title",
      title: "Agent PPT 示例演示",
    },
    {
      id: crypto.randomUUID(),
      type: "set-design-system",
      designSystem: DESIGN_PRESETS.find((preset) => preset.id === "business")!.system,
    },
    {
      id: crypto.randomUUID(),
      type: "set-slide-title",
      slideId: coverSlideId,
      title: "封面",
    },
    {
      id: crypto.randomUUID(),
      type: "update-slide-layout",
      slideId: coverSlideId,
      layout: "cover",
    },
    {
      id: crypto.randomUUID(),
      type: "update-element",
      slideId: coverSlideId,
      elementId: bus.getSnapshot().slides[0].elements[0].id,
      element: {
        ...bus.getSnapshot().slides[0].elements[0],
        type: "text",
        text: "Agent PPT 示例演示",
        fontSize: 56,
        bold: true,
        align: "center",
      },
    },
    {
      id: crypto.randomUUID(),
      type: "add-element",
      slideId: coverSlideId,
      element: {
        id: crypto.randomUUID(),
        type: "text",
        x: 120,
        y: 380,
        width: 1040,
        height: 100,
        text: "由 CommandBus 命令流水线模拟生成",
        fontSize: 28,
        align: "center",
      },
    },
    {
      id: crypto.randomUUID(),
      type: "add-slide",
      index: 1,
      slide: {
        id: crypto.randomUUID(),
        title: "核心观点",
        elements: [
          {
            id: crypto.randomUUID(),
            type: "text",
            x: 120,
            y: 180,
            width: 700,
            height: 360,
            text: "• 数据先变成 Presentation JSON\n• Agent 通过命令修改幻灯片\n• 最后由 pptxgenjs 导出 PPTX",
            fontSize: 30,
          },
          {
            id: crypto.randomUUID(),
            type: "image",
            x: 860,
            y: 180,
            width: 300,
            height: 220,
            url: TINY_PNG_DATA_URL,
          },
        ],
      },
    },
    {
      id: crypto.randomUUID(),
      type: "add-slide",
      index: 2,
      slide: {
        id: crypto.randomUUID(),
        title: "流程对比",
        elements: [
          {
            id: crypto.randomUUID(),
            type: "text",
            x: 120,
            y: 180,
            width: 480,
            height: 320,
            text: "传统手工排版\n\n步骤繁多、样式难统一、修改成本高",
            fontSize: 26,
          },
          {
            id: crypto.randomUUID(),
            type: "text",
            x: 660,
            y: 180,
            width: 480,
            height: 320,
            text: "命令驱动自动生成\n\n支持主题、布局、形状与图片元素\n\n导出后可被 PowerPoint 正常打开",
            fontSize: 26,
          },
        ],
      },
    },
    {
      id: crypto.randomUUID(),
      type: "add-slide",
      index: 3,
      slide: {
        id: crypto.randomUUID(),
        title: "总结",
        elements: [
          {
            id: crypto.randomUUID(),
            type: "text",
            x: 120,
            y: 220,
            width: 1040,
            height: 240,
            text: "下一步：在应用中接入真实 Agent，把大纲与调研资料自动转成幻灯片。",
            fontSize: 32,
            bold: true,
            align: "center",
          },
          {
            id: crypto.randomUUID(),
            type: "shape",
            x: 120,
            y: 500,
            width: 1040,
            height: 8,
            shapeType: "rectangle",
            fillColor: "#38bdf8",
            strokeColor: "#0ea5e9",
          },
        ],
      },
    },
  ]);

  const presentation = bus.getSnapshot();
  const conceptSlideId = presentation.slides[1].id;
  const comparisonSlideId = presentation.slides[2].id;
  const summarySlideId = presentation.slides[3].id;

  bus.execute({
    id: crypto.randomUUID(),
    type: "update-slide-layout",
    slideId: conceptSlideId,
    layout: "concept",
  });
  bus.execute({
    id: crypto.randomUUID(),
    type: "update-slide-layout",
    slideId: comparisonSlideId,
    layout: "comparison",
  });
  bus.execute({
    id: crypto.randomUUID(),
    type: "update-slide-layout",
    slideId: summarySlideId,
    layout: "summary",
  });

  return bus.getSnapshot();
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
  console.log(`设计系统：${presentation.designSystem.tokens.palette}`);
}

main().catch((error) => {
  console.error("生成 PPT 失败：", error);
  process.exitCode = 1;
});
