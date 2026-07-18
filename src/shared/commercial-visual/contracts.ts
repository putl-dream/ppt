import { z } from "zod";

export const COMMERCIAL_SCENE_IDS = [
  "cinematic-cover",
  "numbered-overview",
  "hero-narrative",
  "split-case",
  "dual-evidence",
  "metric-landscape",
  "project-gallery",
  "minimal-epilogue",
] as const;

export type CommercialSceneId = (typeof COMMERCIAL_SCENE_IDS)[number];

export const assetRequestV1Schema = z.object({
  requestId: z.string().min(1),
  slideIndex: z.number().int().nonnegative(),
  slotId: z.string().min(1),
  brief: z.string().min(1),
  required: z.boolean(),
  targetAspectRatio: z.number().positive(),
}).strict();

export const directedSlidePlanV1Schema = z.object({
  slideIndex: z.number().int().nonnegative(),
  sceneId: z.enum(COMMERCIAL_SCENE_IDS),
  variantId: z.string().min(1),
  backgroundMode: z.enum(["light", "dark", "image"]),
  emphasis: z.array(z.string().min(1)).min(1).max(3),
  assetRequests: z.array(assetRequestV1Schema),
  fallbackSceneId: z.enum(COMMERCIAL_SCENE_IDS),
  fallbackVariantId: z.string().min(1),
  fallbackApplied: z.boolean(),
  unresolvedRequiredRequestIds: z.array(z.string().min(1)),
  score: z.object({
    total: z.number().finite(),
    roleMatch: z.number().finite(),
    purposeMatch: z.number().finite(),
    compositionMatch: z.number().finite(),
    contentFit: z.number().finite(),
    rhythmBonus: z.number().finite(),
    repetitionPenalty: z.number().finite(),
  }).strict(),
  rationaleCodes: z.array(z.string().min(1)),
}).strict();

export const directedDeckPlanV1Schema = z.object({
  version: z.literal(1),
  packId: z.literal("editorial-business"),
  compilerVersion: z.string().min(1),
  slides: z.array(directedSlidePlanV1Schema),
}).strict();

const normalizedRectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
}).strict();

export const resolvedAssetV1Schema = z.object({
  requestId: z.string().min(1),
  slotId: z.string().min(1),
  status: z.enum(["resolved", "unavailable"]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  localPath: z.string().min(1).optional(),
  renderUrl: z.string().min(1).optional(),
  mimeType: z.enum(["image/png", "image/jpeg", "image/gif"]).optional(),
  pixelWidth: z.number().int().positive().optional(),
  pixelHeight: z.number().int().positive().optional(),
  focalPoint: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  }).strict().optional(),
  safeCrop: normalizedRectSchema.optional(),
  sourceUrl: z.string().url().optional(),
  sourcePageUrl: z.string().url().optional(),
  provider: z.string().optional(),
  licenseStatus: z.enum(["verified", "unknown", "restricted"]),
  license: z.string().optional(),
  attribution: z.string().optional(),
  rejectionCodes: z.array(z.string()),
}).strict().superRefine((asset, context) => {
  if (asset.status === "resolved" && (!asset.sha256 || !asset.localPath || !asset.mimeType)) {
    context.addIssue({
      code: "custom",
      message: "Resolved assets require sha256, localPath, and mimeType.",
    });
  }
  if (asset.status === "resolved" && asset.licenseStatus === "restricted") {
    context.addIssue({ code: "custom", message: "Restricted assets cannot be resolved." });
  }
});

export const resolvedAssetManifestV1Schema = z.object({
  version: z.literal(1),
  assets: z.array(resolvedAssetV1Schema),
}).strict();

export type AssetRequestV1 = z.infer<typeof assetRequestV1Schema>;
export type DirectedSlidePlanV1 = z.infer<typeof directedSlidePlanV1Schema>;
export type DirectedDeckPlanV1 = z.infer<typeof directedDeckPlanV1Schema>;
export type ResolvedAssetV1 = z.infer<typeof resolvedAssetV1Schema>;
export type ResolvedAssetManifestV1 = z.infer<typeof resolvedAssetManifestV1Schema>;

export const EMPTY_ASSET_MANIFEST: ResolvedAssetManifestV1 = {
  version: 1,
  assets: [],
};
