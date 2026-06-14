import { executeCommand, presentationCommandSchema, type PresentationCommand } from "@shared/commands";
import type { Presentation } from "@shared/presentation";
import { PresentationDiffGenerator, type PresentationDiff } from "./presentation-diff";
import { RiskPolicy, type RiskPolicyResult } from "./risk-policy";

export interface CommitGateResult {
  success: boolean;
  errors: string[];
  diff?: PresentationDiff;
  risk: "low" | "medium" | "high";
  decision: "AUTO" | "REQUIRES_APPROVAL" | "REJECT";
  preview?: Presentation;
}

/**
 * 所有真实 Presentation 修改前的安全闸门。
 *
 * 负责命令 schema 校验、基于快照的沙箱试运行、before/after preview、diff 摘要，
 * 并调用风险策略决定自动应用、请求审批、退回 Runtime 修正或失败。
 *
 * 这是 command_proposal 提交前不可跳过的最终系统校验。无论模型是否调用过
 * PreviewCommands，都必须从当前真实快照重新执行完整校验，不能信任或复用模型侧
 * 的预览结论。两者可以共享底层纯沙箱函数，但不能共享校验责任或跳过本闸门。
 */
export class CommitGate {
  constructor(private readonly riskPolicy: RiskPolicy) {}

  /**
   * 对命令提案进行系统关闸级校验、沙箱执行、Diff 生成和风险评估。
   */
  async evaluate(
    presentation: Presentation,
    commands: PresentationCommand[],
    modelReportedRisk: "low" | "medium" | "high"
  ): Promise<CommitGateResult> {
    const errors: string[] = [];
    let stagedPresentation = structuredClone(presentation);

    // 1. 命令基本校验与沙箱试运行
    for (const cmd of commands) {
      const parseResult = presentationCommandSchema.safeParse(cmd);
      if (!parseResult.success) {
        errors.push(`Schema validation failed: ${parseResult.error.message}`);
        continue;
      }

      try {
        const result = executeCommand(stagedPresentation, parseResult.data);
        stagedPresentation = result.presentation;
      } catch (err) {
        errors.push(`Execution failed for command type '${cmd.type}': ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (errors.length > 0) {
      return {
        success: false,
        errors,
        risk: "high",
        decision: "REJECT",
      };
    }

    // 2. 生成 Diff 差异摘要
    const diff = PresentationDiffGenerator.generate(presentation, stagedPresentation);

    // 3. 计算系统判定风险与决定
    const riskResult = this.riskPolicy.evaluate({
      commands,
      diff,
      modelReportedRisk,
    });

    return {
      success: true,
      errors: [],
      diff,
      risk: riskResult.risk,
      decision: riskResult.decision,
      preview: stagedPresentation,
    };
  }
}
