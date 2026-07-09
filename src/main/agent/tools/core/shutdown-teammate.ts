import { z } from "zod";
import type { TeammateHandle } from "../../teammate/spawn-teammate";
import type { ToolDefinition } from "../tool-definition";

export const shutdownTeammateSchema = z.object({
  name: z.string().describe("Existing teammate name to ask to stop"),
});

export type ShutdownTeammateToolResult = {
  teammate: TeammateHandle;
  message: string;
};

export const shutdownTeammateTool:
  ToolDefinition<typeof shutdownTeammateSchema, ShutdownTeammateToolResult> = {
    name: "shutdown_teammate",
    description: "Ask an existing long-lived teammate agent to stop cleanly.",
    category: "core",
    loadPolicy: "core",
    inputSchema: shutdownTeammateSchema,
    risk: "low",
    permission: {
      profile: "teammate-shutdown",
      description: "Request graceful shutdown for an existing teammate.",
      scopes: ["main"],
      effects: ["workflow.delegate"],
      sandbox: "workspace",
      approval: "never",
    },
    async execute(args, context) {
      if (!context.teammateManager) {
        throw new Error("Teammate manager is not configured.");
      }

      await context.teammateManager.requestShutdown(args.name);
      const teammate = context.teammateManager.get(args.name);
      if (!teammate) {
        throw new Error(`Unknown teammate: ${args.name}`);
      }

      return {
        teammate,
        message: `Requested shutdown for teammate ${teammate.name}.`,
      };
    },
  };
