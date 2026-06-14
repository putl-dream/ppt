import type { PresentationCommand } from "@shared/commands";
import type { PresentationDiff } from "./presentation-diff";

export interface RiskEvaluationInput {
  commands: PresentationCommand[];
  diff: PresentationDiff;
  modelReportedRisk: "low" | "medium" | "high";
}

export interface RiskPolicyResult {
  risk: "low" | "medium" | "high";
  decision: "AUTO" | "REQUIRES_APPROVAL" | "REJECT";
}

/**
 * 命令方案风险等级的系统评估与判定边界。
 *
 * 规划依据破坏性命令、影响页面数、命令数量以及视觉大范围变化等维度评估风险。
 * 系统风险结果优先于模型自报风险（系统可将低风险判定升级，但不予降低）；高风险不可 AUTO apply。
 */
export class RiskPolicy {
  /**
   * 评估指令的真实风险等级并作出执行策略判定
   */
  evaluate(input: RiskEvaluationInput): RiskPolicyResult {
    let assessedRisk: "low" | "medium" | "high" = "low";

    // 1. 根据命令类型进行初步升级
    for (const cmd of input.commands) {
      if (cmd.type === "remove-slide" || cmd.type === "set-theme") {
        assessedRisk = "high";
      } else if (
        cmd.type === "remove-element" ||
        cmd.type === "update-slide-layout" ||
        cmd.type === "restore-slide-elements"
      ) {
        if (assessedRisk !== "high") {
          assessedRisk = "medium";
        }
      }
    }

    // 2. 根据影响的页面数和元素改动数进行升级
    const affectedCount = input.diff.affectedSlideIds.length;
    if (affectedCount > 3 || input.diff.slidesRemovedCount > 0) {
      assessedRisk = "high";
    } else if (affectedCount > 1 || input.diff.elementChanges.removedCount > 2) {
      if (assessedRisk !== "high") {
        assessedRisk = "medium";
      }
    }

    // 3. 对齐模型自报风险（系统可升级，但不做降级）
    const severityMap = { low: 0, medium: 1, high: 2 };
    const systemSeverity = severityMap[assessedRisk];
    const modelSeverity = severityMap[input.modelReportedRisk];

    const finalRisk = systemSeverity >= modelSeverity ? assessedRisk : input.modelReportedRisk;

    // 4. 根据最终风险决策分发
    // high 或 medium 级别不允许直接 AUTO，必须请求用户审批
    const decision = finalRisk === "high" || finalRisk === "medium"
      ? "REQUIRES_APPROVAL" as const
      : "AUTO" as const;

    return {
      risk: finalRisk,
      decision,
    };
  }
}
