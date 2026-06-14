/**
 * Core Tool: 执行已发现且通过 schema/权限检查的 Deferred Tool。
 * 必须拒绝 core、runtime、disabled、未知和未经授权的工具；高风险能力只返回审批要求。
 * 调用前必须确认 toolName 存在于当前 thread 的 ToolDiscoverySession.discoveredToolNames；
 * 仅知道或猜中工具名称不构成执行权限，其他会话中的发现记录也无效。
 * 工具输出仍是分析结果或候选 commands，不能借此直接写入真实 PPT。
 */
