import type { Presentation } from "@shared/presentation";

export interface PresentationDiff {
  titleChanged: boolean;
  oldTitle: string;
  newTitle: string;
  themeChanged: boolean;
  slidesAddedCount: number;
  slidesRemovedCount: number;
  affectedSlideIds: string[];
  elementChanges: {
    addedCount: number;
    removedCount: number;
    updatedCount: number;
  };
}

/**
 * Presentation 快照差异的结构化摘要生成器。
 *
 * 负责识别受影响页面、元素增删改、样式变化和明确未变范围，为审批卡片与预览提供数据。
 */
export class PresentationDiffGenerator {
  /**
   * 对比修改前后两个 Presentation 快照，生成结构化 diff 摘要
   */
  static generate(before: Presentation, after: Presentation): PresentationDiff {
    const affectedSlideIds = new Set<string>();
    let addedCount = 0;
    let removedCount = 0;
    let updatedCount = 0;

    // 比较标题与主题
    const titleChanged = before.title !== after.title;
    const themeChanged = before.theme !== after.theme || before.palette !== after.palette;

    // 统计 slide 增删
    const beforeSlideIds = new Set(before.slides.map((s) => s.id));
    const afterSlideIds = new Set(after.slides.map((s) => s.id));

    let slidesAddedCount = 0;
    let slidesRemovedCount = 0;

    for (const id of afterSlideIds) {
      if (!beforeSlideIds.has(id)) {
        slidesAddedCount++;
        affectedSlideIds.add(id);
      }
    }

    for (const id of beforeSlideIds) {
      if (!afterSlideIds.has(id)) {
        slidesRemovedCount++;
        affectedSlideIds.add(id);
      }
    }

    // 比较留存页面的元素变化
    for (const afterSlide of after.slides) {
      const beforeSlide = before.slides.find((s) => s.id === afterSlide.id);
      if (!beforeSlide) continue; // 新增的已在上面统计

      const beforeElements = new Map(beforeSlide.elements.map((e) => [e.id, e]));
      const afterElements = new Map(afterSlide.elements.map((e) => [e.id, e]));

      let slideChanged = false;

      for (const [id, afterEl] of afterElements.entries()) {
        const beforeEl = beforeElements.get(id);
        if (!beforeEl) {
          addedCount++;
          slideChanged = true;
        } else if (JSON.stringify(beforeEl) !== JSON.stringify(afterEl)) {
          updatedCount++;
          slideChanged = true;
        }
      }

      for (const id of beforeElements.keys()) {
        if (!afterElements.has(id)) {
          removedCount++;
          slideChanged = true;
        }
      }

      if (slideChanged) {
        affectedSlideIds.add(afterSlide.id);
      }
    }

    return {
      titleChanged,
      oldTitle: before.title,
      newTitle: after.title,
      themeChanged,
      slidesAddedCount,
      slidesRemovedCount,
      affectedSlideIds: Array.from(affectedSlideIds),
      elementChanges: {
        addedCount,
        removedCount,
        updatedCount,
      },
    };
  }
}
