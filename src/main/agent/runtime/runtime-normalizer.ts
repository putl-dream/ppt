/**
 * 模型最终响应的协议归一化边界。
 *
 * 负责把供应商响应解析为 message、ask_user 或 command_proposal，并拒绝缺字段、
 * 非法风险等级和无法识别的结构。
 *
 * 不做用户意图分类，不修补 PresentationCommand，也不决定是否审批。
 */
