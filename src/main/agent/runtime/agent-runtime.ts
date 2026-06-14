/**
 * 模型驱动的 Agent Runtime 边界。
 *
 * 负责组装 system prompt、仅加载 Core Tools、执行有步数上限的 tool loop，
 * 并产出 message、ask_user 或 command_proposal 三种协议结果。
 *
 * 不得直接修改 CommandBus、写文件、绕过 SubmitCommands，或调用 runtime-only 工具。
 */
