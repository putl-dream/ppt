/**
 * 所有真实 Presentation 修改前的安全闸门。
 *
 * 负责命令 schema 校验、基于快照的沙箱试运行、before/after preview、diff 摘要，
 * 并调用风险策略决定自动应用、请求审批、退回 Runtime 修正或失败。
 *
 * 这是 command_proposal 提交前不可跳过的最终系统校验。无论模型是否调用过
 * PreviewCommands，都必须从当前真实快照重新执行完整校验，不能信任或复用模型侧
 * 的预览结论。两者可以共享底层纯沙箱函数，但不能共享校验责任或跳过本闸门。
 *
 * Commit Gate 不生成业务命令，也不直接解释用户意图。
 */
