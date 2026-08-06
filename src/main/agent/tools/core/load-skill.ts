import { z } from "zod";
import { isSkillRecommendedForStage } from "../../runtime/prompts/skill-stage-policy";
import { SUB_AGENT_TOOL_PERMISSION_PROFILES } from "../../runtime/tools/tool-access-policy";
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
    "Load full instructions for any registered skill when its specialized knowledge helps the current task. " +
    "Independent skills may be loaded together in the same assistant response; do not open a new model turn per skill.",
  category: "core",
  loadPolicy: "core",
  inputSchema: loadSkillSchema,
  behavior: {
    capabilities: ["skill_load"],
  },
  risk: "low",
  // Same shared profile as the teammate LoadSkill surface (main + subagent scopes).
  permission: SUB_AGENT_TOOL_PERMISSION_PROFILES.LoadSkill,
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
          ? `Unknown skill '${args.skillName}'. Registered skills: ${available.join(", ")}`
          : `Unknown skill '${args.skillName}'. No skills are registered.`,
      );
    }

    const stage = context.promptStage ?? "discover";
    const recommended = isSkillRecommendedForStage(entry.name, stage, entry);

    const alreadyLoaded = context.skillSession?.loadedSkillNames.has(entry.name) ?? false;
    context.skillSession?.loadedSkillNames.add(entry.name);

    return {
      name: entry.name,
      description: entry.description,
      whenToUse: entry.whenToUse,
      content: entry.body,
      alreadyLoaded,
      guidance: alreadyLoaded
        ? "Skill already loaded. Follow it; keep tool use minimal."
        : recommended
          ? "This skill matches the current context. Apply only the parts relevant to the user's task."
          : `This skill is not normally suggested for '${stage}', but it is available. Apply it only where the current task requires it.`,
    };
  },
};
