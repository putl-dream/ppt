import type { Slide, SlideElement } from "@shared/presentation";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * PPT 元素布局的几何与范围约束。
 *
 * 规划定义页面安全区、对齐、间距、溢出、元素最小尺寸和 preserveLayout 规则，
 * 供 AutoLayoutSlide 与 Commit Gate 的预览检查使用。
 */
export class LayoutPolicy {
  // 定义标准 16:9 画布尺寸 (常见宽 1280px，高 720px)
  static readonly CANVAS_WIDTH = 1280;
  static readonly CANVAS_HEIGHT = 720;
  static readonly SAFE_MARGIN = 40; // 四周边距安全区

  /**
   * 检查某个元素是否完全落在画布的安全区域内
   */
  static isWithinSafeZone(box: BoundingBox): boolean {
    const minX = LayoutPolicy.SAFE_MARGIN;
    const maxX = LayoutPolicy.CANVAS_WIDTH - LayoutPolicy.SAFE_MARGIN;
    const minY = LayoutPolicy.SAFE_MARGIN;
    const maxY = LayoutPolicy.CANVAS_HEIGHT - LayoutPolicy.SAFE_MARGIN;

    return (
      box.x >= minX &&
      box.x + box.width <= maxX &&
      box.y >= minY &&
      box.y + box.height <= maxY
    );
  }

  /**
   * Full-bleed media may intentionally cross the content safe margin, but it
   * must still stay entirely on the physical slide canvas.
   */
  static isWithinCanvas(box: BoundingBox): boolean {
    return (
      box.x >= 0 &&
      box.x + box.width <= LayoutPolicy.CANVAS_WIDTH &&
      box.y >= 0 &&
      box.y + box.height <= LayoutPolicy.CANVAS_HEIGHT
    );
  }

  /**
   * 检查两个元素在视觉上是否重叠
   */
  static isOverlapping(a: BoundingBox, b: BoundingBox): boolean {
    return (
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y
    );
  }

  /**
   * 评估单页幻灯片的布局排版是否合规（无严重重叠、溢出安全区等）
   */
  static validateLayout(slide: Slide): { valid: boolean; warnings: string[] } {
    const warnings: string[] = [];

    // 检查是否有元素溢出画布边缘
    for (const el of slide.elements) {
      const isSafe = LayoutPolicy.isWithinSafeZone(el);
      if (!isSafe) {
        warnings.push(`元素 '${el.id}' (${el.type}) 超出页面边界安全区。`);
      }
    }

    // 检查元素重叠冲突
    for (let i = 0; i < slide.elements.length; i++) {
      for (let j = i + 1; j < slide.elements.length; j++) {
        const elA = slide.elements[i];
        const elB = slide.elements[j];
        if (LayoutPolicy.isOverlapping(elA, elB)) {
          warnings.push(`检测到排版重叠冲突: 元素 '${elA.id}' 与 '${elB.id}' 重合。`);
        }
      }
    }

    return {
      valid: warnings.length === 0,
      warnings,
    };
  }
}
