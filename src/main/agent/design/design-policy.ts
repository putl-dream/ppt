import type { Presentation } from "@shared/presentation";

export interface DesignPolicyConstraint {
  id: string;
  name: string;
  validate: (before: Presentation, after: Presentation) => { valid: boolean; message?: string };
}

/**
 * 跨工具共享的视觉设计约束政策定义。
 *
 * 负责声明和校验语义保持、层级对比、可读性及局部修改不外溢等视觉设计基线原则。
 */
export class DesignPolicy {
  private readonly constraints: DesignPolicyConstraint[] = [];

  constructor() {
    this.constraints.push({
      id: "semantic-conservation",
      name: "语义保持校验",
      validate: (before, after) => {
        for (const beforeSlide of before.slides) {
          const afterSlide = after.slides.find((slide) => slide.id === beforeSlide.id);
          if (!afterSlide) continue;

          const beforeTextById = new Map(
            beforeSlide.elements
              .filter((element) => element.type === "text")
              .map((element) => [element.id, element.text.trim()]),
          );
          const afterTextById = new Map(
            afterSlide.elements
              .filter((element) => element.type === "text")
              .map((element) => [element.id, element.text.trim()]),
          );

          for (const [elementId, beforeText] of beforeTextById) {
            const afterText = afterTextById.get(elementId);
            if (afterText === undefined || beforeText.length === 0) continue;
            if (afterText.length === 0) {
              return {
                valid: false,
                message: `Text element '${elementId}' on slide '${beforeSlide.title}' was emptied.`,
              };
            }
            if (beforeText.length >= 80 && afterText.length < beforeText.length * 0.25) {
              return {
                valid: false,
                message:
                  `Text element '${elementId}' on slide '${beforeSlide.title}' lost more than 75% `
                  + "of its content in a single update.",
              };
            }
          }

          const beforeSlideTextLength = [...beforeTextById.values()]
            .reduce((sum, text) => sum + text.length, 0);
          const afterSlideTextLength = [...afterTextById.values()]
            .reduce((sum, text) => sum + text.length, 0);
          if (beforeSlideTextLength > 0 && afterSlideTextLength === 0) {
            return {
              valid: false,
              message: `Slide '${beforeSlide.title}' had all of its text removed.`,
            };
          }
          if (
            beforeSlideTextLength >= 20
            && afterSlideTextLength < beforeSlideTextLength * 0.1
          ) {
            return {
              valid: false,
              message:
                `Slide '${beforeSlide.title}' lost more than 90% of its text while the slide remained.`,
            };
          }
        }
        return { valid: true };
      },
    });
  }

  /**
   * 运行全部视觉约束规则校验，确保排版行为符合设计基线
   */
  validate(before: Presentation, after: Presentation): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    for (const rule of this.constraints) {
      const res = rule.validate(before, after);
      if (!res.valid && res.message) {
        errors.push(`[${rule.name}] ${res.message}`);
      }
    }
    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
