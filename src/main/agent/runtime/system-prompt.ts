/**
 * PPT Agent 系统提示词的唯一组装入口。
 *
 * 负责声明工作环境、Core Tools、延迟工具发现规则、局部修改约束、
 * 语义保持原则和所有真实修改必须经过 SubmitCommands/Commit Gate 的规则。
 *
 * 不嵌入业务实现，不暴露 runtime-only 工具 schema，不承担外部意图分类。
 */
