import { z } from "zod";
import type { ToolDefinition } from "../tool-definition";
import { formatSkillStageRejection, isSkillAllowedForStage } from "../../runtime/skill-stage-policy";

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
    "Load full instructions for a registered skill. Only call when entering a stage that needs it—not for simple slide edits.",
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
      const stage = context.promptStage ?? "discover";
      const available = registry.listCards()
        .filter((card) => isSkillAllowedForStage(card.name, stage, registry.get(card.name)))
        .map((card) => card.name);
      throw new Error(
        available.length > 0
          ? `Unknown skill '${args.skillName}'. Available in stage '${stage}': ${available.join(", ")}`
          : `Unknown skill '${args.skillName}'. No skills are registered.`,
      );
    }

    const stage = context.promptStage ?? "discover";
    if (!isSkillAllowedForStage(entry.name, stage, entry)) {
      throw new Error(formatSkillStageRejection(entry.name, stage, entry));
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
        ? "Skill already loaded. Follow it; keep tool use minimal."
        : "Follow the skill above. Use Task only for workspace files; prefer direct action over extra reads.",
    };
  },
};
