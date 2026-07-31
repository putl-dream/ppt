import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import { presentationCommandSchema } from "@shared/commands";
import {
  agentCommandProposalResultSchema,
  type AgentCommandProposalResult,
} from "../../runtime/runtime-types";
import { requestExplicitlyAllowsContentOnly } from "../../runtime/presentation/presentation-completion-policy";

/** Models often pass a single string; coerce to string[]. */
export const assumptionsSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed ? [trimmed] : undefined;
    }
    return undefined;
  },
  z.array(z.string()).optional(),
);

export const submitCommandsSchema = z.object({
  summary: z.string().describe("该方案的改动摘要说明"),
  commands: z.array(presentationCommandSchema).describe("要提交执行的命令列表"),
  risk: z.enum(["low", "medium", "high"]).default("low").describe("模型评估建议的风险等级"),
  assumptions: assumptionsSchema.describe("模型生成修改方案时采用的假设条件（字符串数组；单条也可）"),
});

/**
 * Core Tool: 提交模型最终的命令方案。
 * 负责封装 summary、commands 和模型建议风险，形成 command_proposal 协议结果。
 * 不执行命令；系统风险策略可以覆盖模型声明的风险等级。
 */
export const submitCommandsTool: ToolDefinition<
  typeof submitCommandsSchema,
  AgentCommandProposalResult
> = {
  name: "SubmitCommands",
  description:
    "旧 element 页面与局部编辑的命令入口。新建或整套重做 PPT 必须先写完整页面 SVG，"
    + "再使用 SubmitSvgDeck；不得用固定 layout handler 拼装新演示。",
  category: "core",
  loadPolicy: "core",
  inputSchema: submitCommandsSchema,
  outputSchema: agentCommandProposalResultSchema,
  behavior: {
    presentation: {
      allowedCapabilities: ["create", "edit", "restyle"],
    },
    capabilities: ["command_proposal"],
    completion: {
      terminalResult: "command_proposal",
      expectation: "always",
      exclusiveBatch: true,
    },
  },
  risk: "low",
  execute: async (args, context) => {
    context.presentationLifecycle?.requireActiveCapability([
      "create",
      "edit",
      "restyle",
    ]);
    const introducesSvgPage = args.commands.some(
      (command) =>
        (command.type === "add-slide" || command.type === "restore-slide")
        && command.slide.visualSource?.kind === "svg",
    );
    if (introducesSvgPage) {
      throw new Error(
        "SubmitCommands cannot introduce SVG-native pages because it has no content-exact "
        + "PreviewSvgPage receipt gate. Preview every current SVG page and use SubmitSvgDeck.",
      );
    }

    const createsLegacyPages = args.commands.some(
      (command) => command.type === "add-slide" || command.type === "restore-slide",
    );
    if (
      createsLegacyPages
      && !requestExplicitlyAllowsContentOnly(context.request)
    ) {
      throw new Error(
        "SubmitCommands cannot create visual slides through the legacy element/layout route. "
        + "Load ppt-workflow, author complete workspace SVG pages, preview every current page "
        + "with PreviewSvgPage, and submit them with SubmitSvgDeck.",
      );
    }
    return {
      type: "command_proposal",
      summary: args.summary,
      commands: args.commands,
      risk: args.risk,
      assumptions: args.assumptions,
    };
  },
};
