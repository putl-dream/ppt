import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import { presentationCommandSchema } from "@shared/commands";
import { executeCommand } from "@shared/commands";
import type { Presentation } from "@shared/presentation";

export const previewCommandsSchema = z.object({
  commands: z.array(presentationCommandSchema).describe("需要进行试运行校验的命令列表"),
});

/**
 * Core Tool: 对候选 PresentationCommand 做沙箱试运行。
 * 返回校验错误、预览 revision 和 diff 摘要，不改变真实 CommandBus 状态。
 *
 * 这是模型工作过程中的可选自检工具，模型可以不调用。预览成功不构成提交凭证，
 * 结果也不能被 Commit Gate 信任或复用为最终校验结论。command_proposal 最终仍必须
 * 进入 SubmitCommands 和 Commit Gate。
 */
export const previewCommandsTool: ToolDefinition<
  typeof previewCommandsSchema,
  { success: boolean; errors: string[]; previewRevision: number; presentation?: Presentation }
> = {
  name: "PreviewCommands",
  description: "在沙箱中试运行一组命令，获取校验错误与预期预览，不修改真实 PPT。",
  category: "core",
  loadPolicy: "core",
  inputSchema: previewCommandsSchema,
  risk: "low",
  execute: async (args, context) => {
    const errors: string[] = [];
    let draft = structuredClone(context.presentation);
    for (const cmd of args.commands) {
      const parsed = presentationCommandSchema.safeParse(cmd);
      if (!parsed.success) {
        errors.push(`Command validation error: ${parsed.error.message}`);
        continue;
      }
      try {
        draft = executeCommand(draft, parsed.data).presentation;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    return {
      success: errors.length === 0,
      errors,
      previewRevision: draft.revision,
      presentation: errors.length === 0 ? draft : undefined,
    };
  },
};
