import { z } from "zod";
import { BACKGROUND_VARIANTS } from "./slide-background";
import { SLIDE_VARIANTS } from "./slide-variant";
import { SVG_PAGE_HEIGHT, SVG_PAGE_WIDTH } from "./svg-page";
import {
  DEFAULT_DESIGN_SYSTEM,
  designSystemV2Schema,
  slideDesignOverrideSchema,
} from "../design-system";

export const hexColorSchema = z.string()
  .regex(/^#[0-9a-f]{6}$/i, "Color must be a six-digit hex value such as #2563eb.");
export const paintColorSchema = z.union([hexColorSchema, z.literal("transparent")]);

const SUPPORTED_DATA_IMAGE_RE =
  /^data:image\/(?:png|jpeg|gif);base64,[a-z0-9+/]+={0,2}$/i;
const URI_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_ABSOLUTE_PATH_RE = /^[a-z]:[\\/]/i;

function hasMatchingRasterSignature(value: string): boolean {
  const separatorIndex = value.indexOf(",");
  if (separatorIndex < 0) return false;
  const header = value.slice(0, separatorIndex).toLowerCase();
  const payload = value.slice(separatorIndex + 1);
  if (header === "data:image/png;base64") return payload.startsWith("iVBORw0KGgo");
  if (header === "data:image/jpeg;base64") return payload.startsWith("/9j/");
  if (header === "data:image/gif;base64") {
    return payload.startsWith("R0lGODdh") || payload.startsWith("R0lGODlh");
  }
  return false;
}

/** Raster data-URL helper retained for workspace asset ingestion. */
export const rasterDataImageSourceSchema = z.string().trim().min(1).max(18 * 1024 * 1024)
  .regex(
    SUPPORTED_DATA_IMAGE_RE,
    "Image data must be a PNG, JPEG, or GIF base64 data URL.",
  )
  .refine(
    hasMatchingRasterSignature,
    "Image data signature does not match its declared PNG, JPEG, or GIF media type.",
  );

export const imageSourceSchema = z.string().trim().min(1).max(18 * 1024 * 1024)
  .superRefine((value, context) => {
    if (
      /^https?:\/\//i.test(value)
      || /^file:\/\//i.test(value)
      || WINDOWS_ABSOLUTE_PATH_RE.test(value)
      || value.startsWith("\\\\")
      || !URI_SCHEME_RE.test(value)
    ) {
      return;
    }
    if (rasterDataImageSourceSchema.safeParse(value).success) return;
    context.addIssue({
      code: "custom",
      message: "Image source must be HTTP(S), file://, a filesystem path, or a PNG/JPEG/GIF base64 data URL.",
    });
  });

export const imageAssetMetadataSchema = z.object({
  provider: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  sourcePageUrl: z.string().url().optional(),
  description: z.string().optional(),
  attribution: z.string().optional(),
  license: z.string().optional(),
  licenseStatus: z.enum(["verified", "unknown", "restricted"]).optional(),
  /** Workspace-relative cached asset path. */
  localPath: z.string().optional(),
  mimeType: z.enum(["image/png", "image/jpeg", "image/gif"]).optional(),
  byteSize: z.number().int().nonnegative().optional(),
  pixelWidth: z.number().int().positive().optional(),
  pixelHeight: z.number().int().positive().optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  fetchedAt: z.string().datetime().optional(),
});

export { SVG_PAGE_HEIGHT, SVG_PAGE_WIDTH } from "./svg-page";

export const slideNarrativeSchema = z.object({
  role: z.string().trim().min(1).max(80),
  coreMessage: z.string().trim().min(1).max(1_000),
  audienceMove: z.string().trim().min(1).max(1_000),
  rhythm: z.enum(["anchor", "dense", "breathing"]),
  layoutIntent: z.string().trim().min(1).max(2_000),
}).strict();

export const svgPageResourceSchema = z.object({
  sourcePath: z.string().trim().min(1),
  mimeType: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]),
  byteSize: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const svgPageVisualSourceSchema = z.object({
  kind: z.literal("svg"),
  markup: z.string()
    .min(1)
    .max(25 * 1024 * 1024)
    .refine((markup) => markup.trim().length > 0, {
      message: "SVG page markup must not be blank.",
    }),
  width: z.literal(SVG_PAGE_WIDTH),
  height: z.literal(SVG_PAGE_HEIGHT),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourcePath: z.string().trim().min(1),
  resources: z.array(svgPageResourceSchema).default([]),
}).strict();

export const slideSchema = z.object({
  id: z.string(),
  title: z.string(),
  speakerNotes: z.string().trim().max(20_000).optional(),
  visualSource: svgPageVisualSourceSchema,
  narrative: slideNarrativeSchema.optional(),
  designOverride: slideDesignOverrideSchema.optional(),
  backgroundVariant: z.enum(BACKGROUND_VARIANTS).optional(),
  slideVariant: z.enum(SLIDE_VARIANTS).optional(),
  sceneRef: z.object({
    packId: z.string().trim().min(1),
    sceneId: z.string().trim().min(1),
    variantId: z.string().trim().min(1),
  }).strict().optional(),
}).strict();

export const presentationSlidesSchema = z.array(slideSchema).superRefine((slides, context) => {
  const seen = new Set<string>();
  slides.forEach((slide, index) => {
    if (seen.has(slide.id)) {
      context.addIssue({
        code: "custom",
        path: [index, "id"],
        message: `Duplicate slide id: ${slide.id}`,
      });
    }
    seen.add(slide.id);
  });
});

export const presentationSchema = z.object({
  id: z.string(),
  title: z.string(),
  revision: z.number().int().nonnegative(),
  slides: presentationSlidesSchema,
  designSystem: designSystemV2Schema,
});

export type ImageAssetMetadata = z.infer<typeof imageAssetMetadataSchema>;
export type SlideNarrative = z.infer<typeof slideNarrativeSchema>;
export type SvgPageResource = z.infer<typeof svgPageResourceSchema>;
export type SvgPageVisualSource = z.infer<typeof svgPageVisualSourceSchema>;
export type Slide = z.infer<typeof slideSchema>;
export type Presentation = z.infer<typeof presentationSchema>;
