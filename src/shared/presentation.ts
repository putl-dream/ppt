import { z } from "zod";
import { FONT_FAMILIES, TEXT_ROLES } from "./typography";
import { BACKGROUND_VARIANTS } from "./slide-background";

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

export const shapeElementSchema = z.object({
  id: z.string(),
  type: z.literal("shape"),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  shapeType: z.enum(["rectangle", "circle", "arrow", "line"]),
  fillColor: z.string().default("#3b82f6"),
  strokeColor: z.string().default("#1d4ed8"),
});

export const slideElementSchema = z.discriminatedUnion("type", [
  textElementSchema,
  imageElementSchema,
  shapeElementSchema,
]);


export const slideSchema = z.object({
  id: z.string(),
  title: z.string(),
  elements: z.array(slideElementSchema),
  layout: z.string().optional(),
  backgroundVariant: z.enum(BACKGROUND_VARIANTS).optional(),
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
export type SlideElement = z.infer<typeof slideElementSchema>;
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

