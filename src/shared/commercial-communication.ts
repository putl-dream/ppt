import { z } from "zod";

export const RESTRUCTURE_PERMISSIONS = [
  "preserve",
  "reorder",
  "rewrite-and-merge",
] as const;

export const NARRATIVE_MODES = [
  "executive-brief",
  "problem-solution",
  "evidence-led",
  "vision-to-action",
] as const;

export const restructurePermissionSchema = z.enum(RESTRUCTURE_PERMISSIONS);
export const narrativeModeSchema = z.enum(NARRATIVE_MODES);

export const COMMERCIAL_COMMUNICATION_DEFAULTS = {
  coreMessage: "围绕演示目标形成一条清晰、可验证的核心结论",
  presentationContext: "正式汇报",
  afterUse: "用于会后决策与行动跟进",
  restructurePermission: "reorder",
  narrativeMode: "executive-brief",
} as const;

export const commercialCommunicationSchema = z.object({
  audience: z.string().trim().min(1).max(100),
  objective: z.string().trim().min(1).max(140),
  desiredAction: z.string().trim().min(1).max(120),
  coreMessage: z.string().trim().min(1).max(160),
  presentationContext: z.string().trim().min(1).max(120),
  afterUse: z.string().trim().min(1).max(120),
  restructurePermission: restructurePermissionSchema,
  narrativeMode: narrativeModeSchema,
}).strict();

export type RestructurePermission = z.infer<typeof restructurePermissionSchema>;
export type NarrativeMode = z.infer<typeof narrativeModeSchema>;
export type CommercialCommunicationContract = z.infer<typeof commercialCommunicationSchema>;

export const RESTRUCTURE_PERMISSION_LABELS: Record<RestructurePermission, string> = {
  preserve: "保持原结构",
  reorder: "允许调整顺序",
  "rewrite-and-merge": "允许重写、合并与删减",
};

export const NARRATIVE_MODE_LABELS: Record<NarrativeMode, string> = {
  "executive-brief": "高管简报",
  "problem-solution": "问题—方案",
  "evidence-led": "证据驱动",
  "vision-to-action": "愿景—行动",
};

export function normalizeRestructurePermission(value: string): RestructurePermission {
  const normalized = value.trim().toLowerCase();
  if (["preserve", "保持原结构", "不允许重构"].includes(normalized)) return "preserve";
  if (["rewrite-and-merge", "允许重写、合并与删减", "完全允许重构"].includes(normalized)) {
    return "rewrite-and-merge";
  }
  return "reorder";
}

export function normalizeNarrativeMode(value: string): NarrativeMode {
  const normalized = value.trim().toLowerCase();
  if (["problem-solution", "问题—方案", "问题-方案"].includes(normalized)) return "problem-solution";
  if (["evidence-led", "证据驱动"].includes(normalized)) return "evidence-led";
  if (["vision-to-action", "愿景—行动", "愿景-行动"].includes(normalized)) return "vision-to-action";
  return "executive-brief";
}
