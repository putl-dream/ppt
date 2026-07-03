import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import {
  formatParallelSubAgentResults,
  spawnSubAgent,
  spawnSubAgentsParallel,
} from "../../subagent/spawn-subagent";

export const taskSchema = z.object({
  description: z.string().optional().describe("Single focused subtask for a sub-agent"),
  descriptions: z.array(z.string()).optional().describe(
    "Multiple independent subtasks to run concurrently; each sub-agent gets isolated context",
  ),
}).superRefine((value, ctx) => {
  const hasDescription = Boolean(value.description?.trim());
  const hasDescriptions = Boolean(value.descriptions?.some((item) => item.trim()));
  if (!hasDescription && !hasDescriptions) {
    ctx.addIssue({
      code: "custom",
      message: "Provide either description or descriptions.",
    });
  }
});

export type TaskToolResult = {
  conclusion: string;
  subtaskCount: number;
};

/**
 * Core Tool: delegate a focused subtask to a sub-agent with isolated context.
 * Only the final conclusion is returned to the main agent transcript.
 */
export function createTaskTool(deps: {
  workspaceRoot?: string;
  spawn?: typeof spawnSubAgent;
  spawnParallel?: typeof spawnSubAgentsParallel;
}): ToolDefinition<typeof taskSchema, TaskToolResult> {
  return {
    name: "Task",
    description:
      "Launch a sub-agent to handle a focused subtask. The sub-agent runs in an isolated context "
      + "and returns only its final conclusion. Use for intermediate work (draft brief, research notes, "
      + "storyboard pages) so the main conversation stays focused on the overall PPT goal. "
      + "Pass descriptions[] to run independent subtasks concurrently.",
    category: "core",
    loadPolicy: "core",
    inputSchema: taskSchema,
    risk: "low",
    execute: async (args, context) => {
      const workspaceRoot = context.workspaceRoot ?? deps.workspaceRoot;
      if (!workspaceRoot) {
        throw new Error("Workspace root is not configured for Task delegation.");
      }
      if (!context.gateway) {
        throw new Error("Model gateway is not configured for Task delegation.");
      }

      const spawn = deps.spawn ?? spawnSubAgent;
      const spawnParallel = deps.spawnParallel ?? spawnSubAgentsParallel;
      const shared = {
        workspaceRoot,
        gateway: context.gateway,
        model: context.model,
        signal: context.signal,
        requestToolApproval: context.requestToolApproval,
      };

      if (args.descriptions?.length) {
        const descriptions = args.descriptions.map((item) => item.trim()).filter(Boolean);
        const conclusions = await spawnParallel(descriptions, shared);
        return {
          conclusion: formatParallelSubAgentResults(descriptions, conclusions),
          subtaskCount: descriptions.length,
        };
      }

      const description = args.description!.trim();
      const conclusion = await spawn({ ...shared, description });
      return { conclusion, subtaskCount: 1 };
    },
  };
}

/** Default Task tool; workspaceRoot/gateway are supplied per-run via ToolContext. */
export const taskTool = createTaskTool({});
