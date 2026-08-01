import { z } from "zod";
import {
  ARGUMENT_MODES,
  DENSITIES,
  READING_MODES,
  VISUAL_STYLES,
  designSystemV2Schema,
} from "@design-system";

/** Project-level template strategy file. */
export const TEMPLATE_POLICY_PATH = "design/template-policy.json";
/**
 * Executable project template pack written by Main on apply/seed.
 * Agent reads only; must not invent conflicting colors/fonts/chrome.
 */
export const TEMPLATE_PACK_PATH = "design/template-pack.json";
/** Uploaded template library root (project-relative). */
export const TEMPLATE_LIBRARY_ROOT = "design/templates";
export const TEMPLATE_LIBRARY_INDEX_PATH = `${TEMPLATE_LIBRARY_ROOT}/index.json`;
/**
 * Application-level uploaded template library, relative to the application data
 * root. Projects still keep their own immutable copy so a deck stays
 * reproducible after the shared library changes.
 */
export const APPLICATION_TEMPLATE_LIBRARY_DIRECTORY = "templates";
/** Project-relative root for media extracted from an applied template revision. */
export const TEMPLATE_ASSET_ROOT = "assets/template";

export const TEMPLATE_KINDS = ["builtin", "uploaded"] as const;
export const TEMPLATE_SUPPORT_LEVELS = [
  "native",
  "design-reference",
  "master-backed",
] as const;
export const TEMPLATE_POLICY_MODES = ["auto", "default", "custom"] as const;
export const TEMPLATE_SELECTION_SOURCES = [
  "explicit-custom",
  "explicit-builtin",
  "auto",
  "fallback",
] as const;
export const TEMPLATE_CAPABILITIES = [
  "image",
  "chart",
  "table",
  "diagram",
  "long-text",
] as const;

export const templateKindSchema = z.enum(TEMPLATE_KINDS);
export const templateSupportLevelSchema = z.enum(TEMPLATE_SUPPORT_LEVELS);
export const templatePolicyModeSchema = z.enum(TEMPLATE_POLICY_MODES);
export const templateSelectionSourceSchema = z.enum(TEMPLATE_SELECTION_SOURCES);
export const templateCapabilitySchema = z.enum(TEMPLATE_CAPABILITIES);
export const templateDensitySchema = z.enum(DENSITIES);

export const templatePreviewSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  /** Project-relative path under the uploaded revision preview directory. */
  imagePath: z.string().trim().min(1).max(512).optional(),
}).strict();

export const uploadedTemplateSourceSchema = z.object({
  originalFileName: z.string().trim().min(1).max(260),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  /** Project-relative path to the immutable source package. */
  sourcePath: z.string().trim().min(1).max(512),
  importedAt: z.string().datetime(),
  packageKind: z.enum(["pptx", "potx"]),
  byteLength: z.number().int().nonnegative(),
}).strict();

export const templateMatchingSchema = z.object({
  topics: z.array(z.string().trim().min(1).max(80)).max(24),
  audiences: z.array(z.string().trim().min(1).max(80)).max(24),
  deliveryContexts: z.array(z.string().trim().min(1).max(80)).max(24),
  argumentModes: z.array(z.enum(ARGUMENT_MODES)).min(1),
  readingModes: z.array(z.enum(READING_MODES)).min(1),
  density: z.array(templateDensitySchema).min(1),
  capabilities: z.array(templateCapabilitySchema).min(1),
}).strict();

export const templateAuthoringGuidanceSchema = z.object({
  composition: z.string().trim().min(1).max(4_000),
  avoid: z.array(z.string().trim().min(1).max(200)).max(24),
  mustUse: z.array(z.string().trim().min(1).max(200)).max(24).optional(),
}).strict();

export const templateChromeBandSchema = z.object({
  text: z.string().trim().min(1).max(200).optional(),
  logoAsset: z.string().trim().min(1).max(512).optional(),
  y: z.number().min(0).max(720),
  height: z.number().min(1).max(240),
  align: z.enum(["left", "center", "right"]).optional(),
  pageNumber: z.boolean().optional(),
}).strict();

export const templateTitleFrameSchema = z.object({
  x: z.number().min(0).max(1280),
  y: z.number().min(0).max(720),
  w: z.number().min(1).max(1280),
  h: z.number().min(1).max(720),
}).strict();

export const templateMarginsSchema = z.object({
  top: z.number().min(0).max(360),
  right: z.number().min(0).max(640),
  bottom: z.number().min(0).max(360),
  left: z.number().min(0).max(640),
}).strict();

export const templateChromeSchema = z.object({
  header: templateChromeBandSchema.optional(),
  footer: templateChromeBandSchema.optional(),
  titleFrame: templateTitleFrameSchema.optional(),
  margins: templateMarginsSchema.optional(),
  background: z.object({
    kind: z.enum(["solid", "gradient", "unknown"]),
    fill: z.string().trim().min(1).max(120).optional(),
  }).strict().optional(),
}).strict();

export const templateTypographyRolesSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(200),
  emphasis: z.string().trim().min(1).max(200),
  data: z.string().trim().min(1).max(200),
  sourceMajor: z.string().trim().min(1).max(120).optional(),
  sourceMinor: z.string().trim().min(1).max(120).optional(),
}).strict();

export const templatePackAssetSchema = z.object({
  role: z.enum(["logo", "background", "decoration", "header", "footer"]),
  path: z.string().trim().min(1).max(512),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
  originalEntry: z.string().trim().min(1).max(260).optional(),
}).strict();

export const templateInheritanceSchema = z.object({
  colors: z.boolean(),
  fonts: z.enum(["preferred", "exact-if-available", "none"]),
  logo: z.boolean(),
  headerFooter: z.boolean(),
  titleFrame: z.boolean(),
  masters: z.literal(false),
  placeholders: z.literal(false),
}).strict();

export const templatePackSchema = z.object({
  version: z.literal(1),
  templateId: z.string().trim().min(1).max(120),
  revisionId: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  supportLevel: z.literal("design-reference"),
  designSystem: designSystemV2Schema,
  typography: templateTypographyRolesSchema,
  chrome: templateChromeSchema.optional(),
  assets: z.array(templatePackAssetSchema).max(32),
  authoringGuidance: templateAuthoringGuidanceSchema,
  inheritance: templateInheritanceSchema,
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  extractedAt: z.string().datetime(),
  warnings: z.array(z.string().trim().min(1).max(400)).max(64).optional(),
}).strict();

export const templateDescriptorSchema = z.object({
  id: z.string().trim().min(1).max(120),
  revisionId: z.string().trim().min(1).max(80),
  kind: templateKindSchema,
  supportLevel: templateSupportLevelSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500),
  preview: templatePreviewSchema.optional(),
  designSystem: designSystemV2Schema,
  matching: templateMatchingSchema,
  authoringGuidance: templateAuthoringGuidanceSchema.optional(),
  source: uploadedTemplateSourceSchema.optional(),
  /** Only builtin auto-pool candidates participate in auto scoring. */
  autoPoolEligible: z.boolean().optional(),
  /** Only templates marked true may be project/application defaults. */
  fallbackEligible: z.boolean().optional(),
}).strict().superRefine((descriptor, context) => {
  if (descriptor.kind === "uploaded" && !descriptor.source) {
    context.addIssue({
      code: "custom",
      path: ["source"],
      message: "Uploaded templates require source metadata.",
    });
  }
  if (descriptor.kind === "builtin" && descriptor.source) {
    context.addIssue({
      code: "custom",
      path: ["source"],
      message: "Builtin templates must not carry uploaded source metadata.",
    });
  }
  if (
    descriptor.supportLevel === "master-backed"
    && descriptor.kind === "uploaded"
  ) {
    context.addIssue({
      code: "custom",
      path: ["supportLevel"],
      message:
        "master-backed support is not available; use design-reference instead.",
    });
  }
});

export const projectTemplatePolicySchema = z.object({
  version: z.literal(1),
  mode: templatePolicyModeSchema,
  defaultTemplateId: z.string().trim().min(1).max(120),
  customTemplateId: z.string().trim().min(1).max(120).optional(),
  customTemplateRevisionId: z.string().trim().min(1).max(80).optional(),
}).strict().superRefine((policy, context) => {
  if (policy.mode === "custom") {
    if (!policy.customTemplateId || !policy.customTemplateRevisionId) {
      context.addIssue({
        code: "custom",
        path: ["customTemplateId"],
        message:
          "mode=custom requires customTemplateId and customTemplateRevisionId.",
      });
    }
  }
});

export const resolvedTemplateSelectionSchema = z.object({
  templateId: z.string().trim().min(1).max(120),
  templateRevisionId: z.string().trim().min(1).max(80),
  source: templateSelectionSourceSchema,
  confidence: z.number().min(0).max(1).optional(),
  reasons: z.array(z.string().trim().min(1).max(200)).max(24),
  fallbackReason: z.string().trim().min(1).max(200).optional(),
  supportLevel: templateSupportLevelSchema,
}).strict();

export const templateMatchScoreSchema = z.object({
  templateId: z.string().trim().min(1).max(120),
  score: z.number(),
  matchedSignals: z.array(z.string().trim().min(1).max(120)).max(32),
  penalties: z.array(z.string().trim().min(1).max(120)).max(32),
}).strict();

export const templateCommunicationSignalsSchema = z.object({
  audience: z.string().trim().min(1).max(1_000).optional(),
  objective: z.string().trim().min(1).max(1_000).optional(),
  desiredOutcome: z.string().trim().min(1).max(1_000).optional(),
  coreMessage: z.string().trim().min(1).max(2_000).optional(),
  deliveryContext: z.string().trim().min(1).max(1_000).optional(),
  afterUse: z.string().trim().min(1).max(1_000).optional(),
  /** Explicit user visual preference (builtin visualStyle id or free text). */
  explicitVisualStyle: z.enum(VISUAL_STYLES).optional(),
  explicitTemplateId: z.string().trim().min(1).max(120).optional(),
  topics: z.array(z.string().trim().min(1).max(80)).max(24).optional(),
  requiredCapabilities: z.array(templateCapabilitySchema).max(8).optional(),
  preferredDensity: templateDensitySchema.optional(),
  preferredArgumentMode: z.enum(ARGUMENT_MODES).optional(),
  preferredReadingMode: z.enum(READING_MODES).optional(),
}).strict();

export const templateInspectionSchema = z.object({
  version: z.literal(1),
  packageKind: z.enum(["pptx", "potx"]),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  byteLength: z.number().int().nonnegative(),
  importedAt: z.string().datetime(),
  slideSize: z.object({
    widthEmu: z.number().int().positive().optional(),
    heightEmu: z.number().int().positive().optional(),
    aspectRatio: z.string().trim().min(1).max(32).optional(),
  }).strict(),
  themeColors: z.object({
    dk1: z.string().optional(),
    lt1: z.string().optional(),
    dk2: z.string().optional(),
    lt2: z.string().optional(),
    accent1: z.string().optional(),
    accent2: z.string().optional(),
    accent3: z.string().optional(),
    accent4: z.string().optional(),
    accent5: z.string().optional(),
    accent6: z.string().optional(),
    hlink: z.string().optional(),
    folHlink: z.string().optional(),
  }).passthrough(),
  fonts: z.object({
    major: z.string().trim().min(1).max(120).optional(),
    minor: z.string().trim().min(1).max(120).optional(),
    used: z.array(z.string().trim().min(1).max(120)).max(64).optional(),
  }).strict(),
  masters: z.array(z.object({
    name: z.string().trim().min(1).max(120),
    layoutCount: z.number().int().nonnegative().optional(),
  }).strict()).max(64),
  layouts: z.array(z.object({
    name: z.string().trim().min(1).max(120),
    placeholderCount: z.number().int().nonnegative().optional(),
  }).strict()).max(128),
  sampleSlideCount: z.number().int().nonnegative(),
  /** Candidate media entries under ppt/media referenced by masters/layouts. */
  mediaCandidates: z.array(z.object({
    entry: z.string().trim().min(1).max(260),
    roleHint: z.enum(["logo", "background", "decoration", "unknown"]).optional(),
    byteLength: z.number().int().nonnegative().optional(),
  }).strict()).max(32).optional(),
  /** Geometry anchors in 1280×720 product canvas space. */
  chrome: templateChromeSchema.optional(),
  warnings: z.array(z.string().trim().min(1).max(400)).max(64),
  supportLevel: z.literal("design-reference"),
}).strict();

export const templateLibraryIndexSchema = z.object({
  version: z.literal(1),
  templates: z.array(z.object({
    id: z.string().trim().min(1).max(120),
    revisionId: z.string().trim().min(1).max(80),
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    name: z.string().trim().min(1).max(120),
    supportLevel: z.literal("design-reference"),
    importedAt: z.string().datetime(),
  }).strict()).max(64),
}).strict();

export type TemplateKind = z.infer<typeof templateKindSchema>;
export type TemplateSupportLevel = z.infer<typeof templateSupportLevelSchema>;
export type TemplatePolicyMode = z.infer<typeof templatePolicyModeSchema>;
export type TemplateSelectionSource = z.infer<typeof templateSelectionSourceSchema>;
export type TemplateCapability = z.infer<typeof templateCapabilitySchema>;
export type TemplateDescriptor = z.infer<typeof templateDescriptorSchema>;
export type ProjectTemplatePolicy = z.infer<typeof projectTemplatePolicySchema>;
export type ResolvedTemplateSelection = z.infer<typeof resolvedTemplateSelectionSchema>;
export type TemplateMatchScore = z.infer<typeof templateMatchScoreSchema>;
export type TemplateCommunicationSignals = z.infer<typeof templateCommunicationSignalsSchema>;
export type TemplateInspection = z.infer<typeof templateInspectionSchema>;
export type TemplateLibraryIndex = z.infer<typeof templateLibraryIndexSchema>;
export type UploadedTemplateSource = z.infer<typeof uploadedTemplateSourceSchema>;
export type TemplateAuthoringGuidance = z.infer<typeof templateAuthoringGuidanceSchema>;
export type TemplatePreview = z.infer<typeof templatePreviewSchema>;
export type TemplatePack = z.infer<typeof templatePackSchema>;
export type TemplateTypographyRoles = z.infer<typeof templateTypographyRolesSchema>;
export type TemplateChrome = z.infer<typeof templateChromeSchema>;
export type TemplatePackAsset = z.infer<typeof templatePackAssetSchema>;
export type TemplateInheritance = z.infer<typeof templateInheritanceSchema>;

export function formatTemplatePack(pack: TemplatePack): string {
  return `${JSON.stringify(pack, null, 2)}\n`;
}

export function templateAssetDirectory(revisionId: string): string {
  const safeRevision = revisionId.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return `${TEMPLATE_ASSET_ROOT}/${safeRevision}`;
}

export const APPLICATION_DEFAULT_TEMPLATE_ID = "builtin/swiss-minimal";
export const TEMPLATE_CATALOG_REVISION = "1";

export function createDefaultProjectTemplatePolicy(
  defaultTemplateId: string = APPLICATION_DEFAULT_TEMPLATE_ID,
): ProjectTemplatePolicy {
  return projectTemplatePolicySchema.parse({
    version: 1,
    mode: "auto",
    defaultTemplateId,
  });
}

export function formatProjectTemplatePolicy(
  policy: ProjectTemplatePolicy = createDefaultProjectTemplatePolicy(),
): string {
  return `${JSON.stringify(policy, null, 2)}\n`;
}

/** Uploaded template ids are minted by the import service as `uploaded/<uuid>`. */
export function isUploadedTemplateId(templateId: string): boolean {
  return templateId.startsWith("uploaded/");
}

/** Library-relative `<template-id>/<revision-id>` path segment. */
export function templateRevisionSubPath(
  templateId: string,
  revisionId: string,
): string {
  const safeId = templateId.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const safeRevision = revisionId.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return `${safeId}/${safeRevision}`;
}

export function templateRevisionPath(
  templateId: string,
  revisionId: string,
): string {
  return `${TEMPLATE_LIBRARY_ROOT}/${templateRevisionSubPath(templateId, revisionId)}`;
}
