import type { Presentation } from "@shared/presentation";

export function presentationUsesSvgPages(presentation: Presentation): boolean {
  return presentation.slides.some((slide) => slide.visualSource?.kind === "svg");
}

export function confirmSvgExportExpectation(presentation: Presentation): boolean {
  if (!presentationUsesSvgPages(presentation)) return true;
  return window.confirm(
    "当前演示文稿以整页 SVG 导出。PowerPoint 中页面以图片形式呈现，文字与形状通常不可再单独编辑。是否继续导出？",
  );
}
