import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";

export const loadSkillSchema = z.object({
  skillName: z.string().describe("Registered skill name from the Available Skills catalog"),
});

export interface LoadSkillResult {
  name: string;
  description: string;
  whenToUse?: string;
  content: string;
  alreadyLoaded: boolean;
  guidance: string;
}

/**
 * Core Tool: load full SKILL.md body on demand.
 * Lookup goes through SkillRegistry — never accepts raw file paths.
 */
export const loadSkillTool: ToolDefinition<typeof loadSkillSchema, LoadSkillResult> = {
  name: "LoadSkill",
  description:
    "Load the full instructions for a registered skill. Call when a task matches a skill in the Available Skills catalog.",
  category: "core",
  loadPolicy: "core",
  inputSchema: loadSkillSchema,
  risk: "low",
  execute: async (args, context) => {
    const registry = context.skillRegistry;
    if (!registry) {
      throw new Error("Skill registry is not available in this runtime.");
    }

    const entry = registry.get(args.skillName);
    if (!entry) {
      const available = registry.listCards().map((card) => card.name);
      throw new Error(
        available.length > 0
          ? `Unknown skill '${args.skillName}'. Available: ${available.join(", ")}`
          : `Unknown skill '${args.skillName}'. No skills are registered.`,
      );
    }

    const alreadyLoaded = context.skillSession?.loadedSkillNames.has(entry.name) ?? false;
    context.skillSession?.loadedSkillNames.add(entry.name);

    return {
      name: entry.name,
      description: entry.description,
      whenToUse: entry.whenToUse,
      content: entry.body,
      alreadyLoaded,
      guidance: alreadyLoaded
        ? "Skill was already loaded this run. Follow its instructions; additional resources may be accessed via Task sub-agents."
        : "Follow the skill instructions above. Use Task to read or write workspace files referenced by the skill.",
    };
  },
};
