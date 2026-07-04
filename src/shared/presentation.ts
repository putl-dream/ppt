import { z } from "zod";
import { FONT_FAMILIES, TEXT_ROLES } from "./typography";
import { BACKGROUND_VARIANTS } from "./slide-background";
import { SLIDE_VARIANTS } from "./slide-variant";
import { ICON_NAMES } from "./icon-registry";

export const CHART_TYPES = ["bar", "h-bar", "timeline", "kpi-tower"] as const;

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
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  chartType: z.enum(CHART_TYPES),
  data: chartDataSchema,
  accentColor: z.string().optional(),
});

export const tableElementSchema = z.object({
  id: z.string(),
  type: z.literal("table"),
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

export const imageElementSchema = z.object({
  id: z.string(),
  type: z.literal("image"),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  url: z.string(),
  borderRadius: z.number().optional().default(0),
  imageSlot: z.string().optional(),
  objectFit: z.enum(["cover", "contain"]).optional(),
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
  backgroundVariant: z.enum(BACKGROUND_VARIANTS).optional(),
  slideVariant: z.enum(SLIDE_VARIANTS).optional(),
});

export const presentationSchema = z.object({
  id: z.string(),
  title: z.string(),
  revision: z.number().int().nonnegative(),
  slides: z.array(slideSchema),
  theme: z.string().optional(),
  palette: z.string().optional(),
});

export type TextElement = z.infer<typeof textElementSchema>;
export type ImageElement = z.infer<typeof imageElementSchema>;
export type ShapeElement = z.infer<typeof shapeElementSchema>;
export type ChartElement = z.infer<typeof chartElementSchema>;
export type TableElement = z.infer<typeof tableElementSchema>;
export type IconElement = z.infer<typeof iconElementSchema>;
export type SlideElement = z.infer<typeof slideElementSchema>;
export type ChartData = z.infer<typeof chartDataSchema>;
export type Slide = z.infer<typeof slideSchema>;
export type Presentation = z.infer<typeof presentationSchema>;

export function createStarterPresentation(): Presentation {
  return {
    id: crypto.randomUUID(),
    title: "Untitled presentation",
    revision: 0,
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

