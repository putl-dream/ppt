import { z } from "zod";
import { FONT_FAMILIES, TEXT_ROLES } from "./typography";
import { BACKGROUND_VARIANTS } from "./slide-background";
import { SLIDE_VARIANTS } from "./slide-variant";
import { ICON_NAMES } from "./icon-registry";
import {
  CHART_STYLES,
  IMAGE_TREATMENTS,
  DEFAULT_DESIGN_SYSTEM,
  designSystemV1Schema,
  slideDesignOverrideSchema,
} from "../design-system";

export const CHART_TYPES = ["bar", "h-bar", "timeline", "kpi-tower"] as const;
export const ELEMENT_PROVENANCE = ["layout", "user", "agent", "asset"] as const;

export const elementProvenanceSchema = z.enum(ELEMENT_PROVENANCE);

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

const chartItemSchema = z.object({
  label: z.string().trim().min(1),
  value: z.number().finite(),
});

export const chartDataSchema = z.object({
  labels: z.array(z.string().trim().min(1)).optional(),
  values: z.array(z.number().finite()).optional(),
  items: z.array(chartItemSchema).optional(),
}).superRefine((data, context) => {
  const itemCount = data.items?.length ?? 0;
  const labelCount = data.labels?.length ?? 0;
  const valueCount = data.values?.length ?? 0;
  const hasParallelData = labelCount > 0 || valueCount > 0;

  if (itemCount > 0 && hasParallelData) {
    context.addIssue({
      code: "custom",
      message: "Chart data must use either items or labels/values, not both.",
    });
    return;
  }

  if (itemCount === 0) {
    if (labelCount === 0 || valueCount === 0) {
      context.addIssue({
        code: "custom",
        message: "Chart data requires at least one item or a non-empty labels/values pair.",
      });
      return;
    }
    if (labelCount !== valueCount) {
      context.addIssue({
        code: "custom",
        message: "Chart labels and values must have the same length.",
      });
    }
  }
});

export const chartElementSchema = z.object({
  id: z.string(),
  type: z.literal("chart"),
  provenance: elementProvenanceSchema.optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  chartType: z.enum(CHART_TYPES),
  data: chartDataSchema,
  accentColor: hexColorSchema.optional(),
  chartStyle: z.enum(CHART_STYLES).optional(),
  unit: z.string().trim().max(30).optional(),
  highlightIndex: z.number().int().nonnegative().optional(),
}).superRefine((element, context) => {
  const dataLength = element.data.items?.length
    ?? Math.min(element.data.labels?.length ?? 0, element.data.values?.length ?? 0);
  if (element.highlightIndex !== undefined && element.highlightIndex >= dataLength) {
    context.addIssue({
      code: "custom",
      path: ["highlightIndex"],
      message: `highlightIndex must be smaller than the chart data length (${dataLength}).`,
    });
  }
});

export const tableElementSchema = z.object({
  id: z.string(),
  type: z.literal("table"),
  provenance: elementProvenanceSchema.optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  rows: z.array(z.array(z.string()).min(1)).min(1),
  headerRow: z.boolean().optional().default(true),
  zebraStripe: z.boolean().optional().default(true),
}).superRefine((element, context) => {
  const columnCount = element.rows[0]?.length ?? 0;
  element.rows.forEach((row, rowIndex) => {
    if (row.length !== columnCount) {
      context.addIssue({
        code: "custom",
        path: ["rows", rowIndex],
        message: `Table rows must all contain ${columnCount} column(s).`,
      });
    }
  });
});

export const iconElementSchema = z.object({
  id: z.string(),
  type: z.literal("icon"),
  provenance: elementProvenanceSchema.optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  name: z.enum(ICON_NAMES),
  color: hexColorSchema.optional(),
  strokeWidth: z.number().positive().optional().default(2),
});

export const textElementSchema = z.object({
  id: z.string(),
  type: z.literal("text"),
  provenance: elementProvenanceSchema.optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  text: z.string(),
  fontSize: z.number().positive().default(32),
  bold: z.boolean().optional(),
  color: hexColorSchema.optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  textRole: z.enum(TEXT_ROLES).optional(),
  fontFamily: z.enum(FONT_FAMILIES).optional(),
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

export const imageElementSchema = z.object({
  id: z.string(),
  type: z.literal("image"),
  provenance: elementProvenanceSchema.optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  url: imageSourceSchema,
  borderRadius: z.number().optional().default(0),
  imageSlot: z.string().optional(),
  objectFit: z.enum(["cover", "contain"]).optional(),
  crop: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  }).strict().superRefine((crop, context) => {
    if (crop.x + crop.width > 1 || crop.y + crop.height > 1) {
      context.addIssue({
        code: "custom",
        message: "Image crop must stay inside normalized image bounds.",
      });
    }
  }).optional(),
  imageTreatment: z.enum(IMAGE_TREATMENTS).optional(),
  asset: imageAssetMetadataSchema.optional(),
});

export const shadowSchema = z.object({
  color: hexColorSchema.default("#000000"),
  blur: z.number().default(12),
  offsetX: z.number().default(0),
  offsetY: z.number().default(4),
  opacity: z.number().min(0).max(1).default(0.15),
});

export const shapeElementSchema = z.object({
  id: z.string(),
  type: z.literal("shape"),
  provenance: elementProvenanceSchema.optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  shapeType: z.enum(["rectangle", "circle", "arrow", "line", "roundedRect"]),
  fillColor: paintColorSchema.default("#3b82f6"),
  strokeColor: paintColorSchema.default("#1d4ed8"),
  cornerRadius: z.number().optional(),
  fillOpacity: z.number().min(0).max(1).optional(),
  shadow: shadowSchema.optional(),
});

export const slideElementSchema = z.discriminatedUnion("type", [
  textElementSchema,
  imageElementSchema,
  shapeElementSchema,
  chartElementSchema,
  tableElementSchema,
  iconElementSchema,
]);

export const slideElementsSchema = z.array(slideElementSchema).superRefine((elements, context) => {
  const seen = new Set<string>();
  elements.forEach((element, index) => {
    if (seen.has(element.id)) {
      context.addIssue({
        code: "custom",
        path: [index, "id"],
        message: `Duplicate element id: ${element.id}`,
      });
    }
    seen.add(element.id);
  });
});


export const slideSchema = z.object({
  id: z.string(),
  title: z.string(),
  speakerNotes: z.string().trim().max(20_000).optional(),
  elements: slideElementsSchema,
  layout: z.string().optional(),
  grammarVariant: z.string().optional(),
  designOverride: slideDesignOverrideSchema.optional(),
  backgroundVariant: z.enum(BACKGROUND_VARIANTS).optional(),
  slideVariant: z.enum(SLIDE_VARIANTS).optional(),
  sceneRef: z.object({
    packId: z.string().trim().min(1),
    sceneId: z.string().trim().min(1),
    variantId: z.string().trim().min(1),
  }).strict().optional(),
});

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
  designSystem: designSystemV1Schema,
});

export type TextElement = z.infer<typeof textElementSchema>;
export type ImageAssetMetadata = z.infer<typeof imageAssetMetadataSchema>;
export type ImageElement = z.infer<typeof imageElementSchema>;
export type ShapeElement = z.infer<typeof shapeElementSchema>;
export type ChartElement = z.infer<typeof chartElementSchema>;
export type TableElement = z.infer<typeof tableElementSchema>;
export type IconElement = z.infer<typeof iconElementSchema>;
export type SlideElement = z.infer<typeof slideElementSchema>;
export type ChartData = z.infer<typeof chartDataSchema>;
export type Slide = z.infer<typeof slideSchema>;
export type Presentation = z.infer<typeof presentationSchema>;
export type ElementProvenance = z.infer<typeof elementProvenanceSchema>;

export function createStarterPresentation(): Presentation {
  return {
    id: crypto.randomUUID(),
    title: "Untitled presentation",
    revision: 0,
    designSystem: DEFAULT_DESIGN_SYSTEM,
    slides: [
      {
        id: crypto.randomUUID(),
        title: "Opening",
        elements: [
          {
            id: crypto.randomUUID(),
            type: "text",
            x: 120,
            y: 180,
            width: 1040,
            height: 160,
            text: "Agent PPT",
            fontSize: 64,
          },
        ],
      },
    ],
  };
}

