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
    // 注入默认约束：例如“不能擅自清空页面内的主体文本框”
    this.constraints.push({
      id: "semantic-conservation",
      name: "语义保持校验",
      validate: (before, after) => {
        // 简单模拟校验：如果修改后幻灯片内的总字符数下降超过 80%，判定为有语义丢失风险
        const beforeLen = before.slides.reduce((acc, s) => acc + s.elements.reduce((sum, el) => sum + (el.type === "text" ? el.text.length : 0), 0), 0);
        const afterLen = after.slides.reduce((acc, s) => acc + s.elements.reduce((sum, el) => sum + (el.type === "text" ? el.text.length : 0), 0), 0);
        
        if (beforeLen > 5 && afterLen < beforeLen * 0.2) {
          return {
            valid: false,
            message: "修改后文本长度严重缩减，可能丢失了原有内容语义。建议使用 Rewrite 或 Compress 工具完成改写。",
          };
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
