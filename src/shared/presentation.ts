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

export const chartDataSchema = z.object({
  labels: z.array(z.string()).optional(),
  values: z.array(z.number()).optional(),
  items: z
    .array(z.object({ label: z.string(), value: z.number() }))
    .optional(),
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
  accentColor: z.string().optional(),
  chartStyle: z.enum(CHART_STYLES).optional(),
  unit: z.string().optional(),
  highlightIndex: z.number().int().nonnegative().optional(),
});

export const tableElementSchema = z.object({
  id: z.string(),
  type: z.literal("table"),
  provenance: elementProvenanceSchema.optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  rows: z.array(z.array(z.string())).min(1),
  headerRow: z.boolean().optional().default(true),
  zebraStripe: z.boolean().optional().default(true),
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
  color: z.string().optional(),
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
  color: z.string().optional(),
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
  /** Workspace-relative cached asset path. */
  localPath: z.string().optional(),
  mimeType: z.enum(["image/png", "image/jpeg", "image/gif"]).optional(),
  byteSize: z.number().int().nonnegative().optional(),
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
  url: z.string(),
  borderRadius: z.number().optional().default(0),
  imageSlot: z.string().optional(),
  objectFit: z.enum(["cover", "contain"]).optional(),
  imageTreatment: z.enum(IMAGE_TREATMENTS).optional(),
  asset: imageAssetMetadataSchema.optional(),
});

export const shadowSchema = z.object({
  color: z.string().default("#000000"),
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
  fillColor: z.string().default("#3b82f6"),
  strokeColor: z.string().default("#1d4ed8"),
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


export const slideSchema = z.object({
  id: z.string(),
  title: z.string(),
  elements: z.array(slideElementSchema),
  layout: z.string().optional(),
  grammarVariant: z.string().optional(),
  designOverride: slideDesignOverrideSchema.optional(),
  backgroundVariant: z.enum(BACKGROUND_VARIANTS).optional(),
  slideVariant: z.enum(SLIDE_VARIANTS).optional(),
});

export const presentationSchema = z.object({
  id: z.string(),
  title: z.string(),
  revision: z.number().int().nonnegative(),
  slides: z.array(slideSchema),
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

