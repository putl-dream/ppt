import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import type { Presentation } from "@shared/presentation";

export const readPresentationSnapshotSchema = z.object({});

/**
 * Core Tool: 读取整套 PPT 的只读快照与摘要。
 * 用于全局美化、结构理解和未指定页码的请求。
 * 只返回必要摘要，不修改 Presentation，不返回可写引用。
 */
export const readPresentationSnapshotTool: ToolDefinition<
  typeof readPresentationSnapshotSchema,
  { presentation: Presentation }
> = {
  name: "ReadPresentationSnapshot",
  description: "读取整套演示文稿的结构与快照数据。",
  category: "core",
  loadPolicy: "core",
  inputSchema: readPresentationSnapshotSchema,
  risk: "low",
  execute: async (_, context) => {
    return { presentation: context.presentation };
  },
};
