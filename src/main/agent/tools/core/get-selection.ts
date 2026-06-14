import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";

export const getSelectionSchema = z.object({});

/**
 * Core Tool: 读取用户当前选中的页面和元素标识。
 * 用于“这个”“选中的内容”等指代请求。
 * 只反映编辑器事实；无选择时返回空集合，不推断目标。
 */
export const getSelectionTool: ToolDefinition<
  typeof getSelectionSchema,
  { currentSlideId?: string; selectedElementIds: string[] }
> = {
  name: "GetSelection",
  description: "获取用户当前在 PPT 编辑器中选中的页面 ID 和元素 ID 列表。",
  category: "core",
  loadPolicy: "core",
  inputSchema: getSelectionSchema,
  risk: "low",
  execute: async (_, context) => {
    return {
      currentSlideId: context.currentSlideId,
      selectedElementIds: context.selectedElementIds,
    };
  },
};
