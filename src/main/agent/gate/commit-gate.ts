/**
 * 所有真实 Presentation 修改前的安全闸门。
 *
 * 负责命令 schema 校验、基于快照的沙箱试运行、before/after preview、diff 摘要，
 * 并调用风险策略决定自动应用、请求审批、退回 Runtime 修正或失败。
 *
 * Commit Gate 不生成业务命令，也不直接解释用户意图。
 */
