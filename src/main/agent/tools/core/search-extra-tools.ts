/**
 * Core Tool: 搜索未默认加载的 Deferred Tools。
 * 仅在 Core Tools 无法完成任务时使用，支持按名称精确选择和按能力关键词查询。
 * 搜索范围必须排除 core、runtime、disabled 和未授权工具。
 * 每次实际返回的工具名必须写入当前 thread 的 ToolDiscoverySession。
 */
