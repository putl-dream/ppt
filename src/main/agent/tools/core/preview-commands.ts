/**
 * Core Tool: 对候选 PresentationCommand 做沙箱试运行。
 * 返回校验错误、预览 revision 和 diff 摘要，不改变真实 CommandBus 状态。
 * 预览成功也不代表允许落盘，最终仍必须进入 SubmitCommands 和 Commit Gate。
 */
