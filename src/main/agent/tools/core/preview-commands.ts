/**
 * Core Tool: 对候选 PresentationCommand 做沙箱试运行。
 * 返回校验错误、预览 revision 和 diff 摘要，不改变真实 CommandBus 状态。
 *
 * 这是模型工作过程中的可选自检工具，模型可以不调用。预览成功不构成提交凭证，
 * 结果也不能被 Commit Gate 信任或复用为最终校验结论。command_proposal 最终仍必须
 * 进入 SubmitCommands 和 Commit Gate。
 */
