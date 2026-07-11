import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import type { PresentationCommand } from "@shared/commands";
import { designSystemV1Schema } from "@design-system";

export const applyDesignSystemSchema = z.object({
  designSystem: designSystemV1Schema.describe("完整 DesignSystemV1 设计意图"),
});

/** 生成整套演示文稿的设计系统更新命令。 */
export const applyDesignSystemTool: ToolDefinition<
  typeof applyDesignSystemSchema,
  { commands: PresentationCommand[] }
> = {
  name: "ApplyDesignSystem",
  description: "应用完整设计系统到当前演示文稿，并重新编译已排版页面。",
  category: "deferred",
  loadPolicy: "deferred",
  inputSchema: applyDesignSystemSchema,
  risk: "medium",
  execute: async (args) => ({
    commands: [{
      id: crypto.randomUUID(),
      type: "set-design-system",
      designSystem: args.designSystem,
    }],
  }),
};
