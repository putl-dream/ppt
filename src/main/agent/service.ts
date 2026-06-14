/**
 * Agent 对主进程暴露的应用服务边界。
 *
 * 主要职责：接收 start/resume 请求，创建 threadId，调用 workflow，
 * 将 Graph 状态转换为 chat、approval-required、completed 或 rejected 结果，
 * 并向 IPC 层转发稳定的进度事件。
 *
 * 不负责：意图分类、模型 tool loop、工具注册、命令校验、风险判断和命令执行。
 * 迁移前 AgentService 仍位于 workflow.ts，本文件暂不提供实现或导出。
 */
