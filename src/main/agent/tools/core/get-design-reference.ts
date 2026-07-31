import { z } from "zod";
import {
  ARGUMENT_MODES,
  READING_MODES,
  VISUAL_STYLES,
  SVG_COMPOSITION_DISCIPLINE,
  getArgumentModeDefinition,
  getReadingModeDefinition,
  getVisualStyleDefinition,
} from "@design-system";
import { DESIGN_CAPABILITY_VERSION } from "@shared/design-capability";
import type { ToolDefinition } from "../tool-definition";

export const getDesignReferenceSchema = z.object({
  argumentMode: z.enum(ARGUMENT_MODES),
  visualStyle: z.enum(VISUAL_STYLES),
  readingMode: z.enum(READING_MODES),
}).strict();

/**
 * Exposes the executable behavior distilled from ppt-master's mode/style
 * references after the strategist has selected one coherent direction.
 */
export const getDesignReferenceTool: ToolDefinition<
  typeof getDesignReferenceSchema,
  ReturnType<typeof resolveReference>
> = {
  name: "GetDesignReference",
  description:
    "在写 SVG 前读取已锁定 argument mode、visual style、reading mode 的完整执行参考："
    + "论证骨架、标题语气、构图几何、留白、字体、质感、图像语言与明确禁用项。"
    + "它把 ppt-master 参考目录的行为约束直接交给 SVG 作者，避免只拿到风格枚举。",
  category: "core",
  loadPolicy: "core",
  inputSchema: getDesignReferenceSchema,
  behavior: {
    presentation: {
      allowedCapabilities: ["create", "edit", "restyle"],
    },
  },
  risk: "low",
  execute: async (args) => resolveReference(args),
};

function resolveReference(args: z.infer<typeof getDesignReferenceSchema>) {
  const argument = getArgumentModeDefinition(args.argumentMode);
  const style = getVisualStyleDefinition(args.visualStyle);
  const reading = getReadingModeDefinition(args.readingMode);
  return {
    capabilityVersion: DESIGN_CAPABILITY_VERSION,
    argument: {
      id: argument.id,
      label: argument.label,
      narrativeSkeleton: argument.narrativeSkeleton,
      titleVoice: argument.titleVoice,
      pageStructures: argument.pageStructures,
      speakerNotesRegister: argument.speakerNotesRegister,
      hardRules: argument.hardRules,
      antiPatterns: argument.antiPatterns,
      titleExamples: argument.titleExamples,
      pageSkeletons: argument.pageSkeletons,
    },
    visual: {
      id: style.id,
      label: style.label,
      summary: style.summary,
      bestFor: style.bestFor,
      shape: style.shape,
      elevation: style.elevation,
      whitespace: style.whitespace,
      typography: style.typography,
      background: style.background,
      texture: style.texture,
      composition: style.grammarPreferences.composition,
      compositionDiscipline: SVG_COMPOSITION_DISCIPLINE,
      avoid: style.grammarPreferences.avoid,
      imageLanguage: {
        rendering: style.imageRendering,
        treatment: style.imageTreatment,
        illustrationPropensity: style.illustrationPropensity,
      },
    },
    reading: {
      id: reading.id,
      label: reading.label,
      bodySize: reading.bodySize,
      density: reading.density,
      spacingScale: reading.spacingScale,
      typographyScale: reading.typographyScale,
      maxBodyCharacters: reading.maxBodyCharacters,
      visualBurden: reading.visualBurden,
    },
    authoringDirective:
      "Translate this behavior into page-specific SVG composition. Keep the deck-wide language, "
      + "but do not copy a fixed coordinate template or repeat one card grid across pages.",
  };
}
