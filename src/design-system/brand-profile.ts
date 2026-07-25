import { z } from "zod";

import {
  colorOverridesSchema,
  colorSchemeSchema,
  designSystemV2Schema,
  READING_MODES,
  VISUAL_STYLES,
  ARGUMENT_MODES,
  type DesignSystemV2,
} from "./schema";

export const BRAND_PERSONAS = [
  "consulting",
  "financial-editorial",
  "product-technology",
  "brand-launch",
  "academic-report",
  "youth-consumer",
] as const;

export const brandDesignOverridesSchema = z.object({
  argumentMode: z.enum(ARGUMENT_MODES).optional(),
  visualStyle: z.enum(VISUAL_STYLES).optional(),
  colorScheme: colorSchemeSchema.optional(),
  readingMode: z.enum(READING_MODES).optional(),
  colors: colorOverridesSchema.optional(),
}).strict();

export const brandProfileV2Schema = z.object({
  version: z.literal(2),
  brandName: z.string().trim().min(1).max(80),
  persona: z.enum(BRAND_PERSONAS),
  audience: z.string().trim().min(1).max(120),
  attributes: z.array(z.string().trim().min(1).max(40)).min(2).max(6),
  avoid: z.array(z.string().trim().min(1).max(80)).max(8),
  designOverrides: brandDesignOverridesSchema.default({}),
}).strict();

export type BrandPersona = (typeof BRAND_PERSONAS)[number];
export type BrandProfileV2 = z.infer<typeof brandProfileV2Schema>;

export const DEFAULT_BRAND_PROFILE: BrandProfileV2 = {
  version: 2,
  brandName: "未命名品牌",
  persona: "consulting",
  audience: "业务决策者",
  attributes: ["可信", "清晰", "克制"],
  avoid: ["无意义装饰", "低对比度正文"],
  designOverrides: {},
};

const PERSONA_SYSTEMS: Record<BrandPersona, DesignSystemV2> = {
  consulting: designSystemV2Schema.parse({
    version: 2,
    argumentMode: "pyramid",
    visualStyle: "swiss-minimal",
    colorScheme: "mono-report",
    readingMode: "balanced",
  }),
  "financial-editorial": designSystemV2Schema.parse({
    version: 2,
    argumentMode: "pyramid",
    visualStyle: "data-journalism",
    colorScheme: "warm-paper",
    readingMode: "text",
  }),
  "product-technology": designSystemV2Schema.parse({
    version: 2,
    argumentMode: "instructional",
    visualStyle: "dark-tech",
    colorScheme: "tech-dark",
    readingMode: "balanced",
  }),
  "brand-launch": designSystemV2Schema.parse({
    version: 2,
    argumentMode: "showcase",
    visualStyle: "glassmorphism",
    colorScheme: "business-blue",
    readingMode: "presentation",
  }),
  "academic-report": designSystemV2Schema.parse({
    version: 2,
    argumentMode: "briefing",
    visualStyle: "editorial",
    colorScheme: "soft-academic",
    readingMode: "text",
  }),
  "youth-consumer": designSystemV2Schema.parse({
    version: 2,
    argumentMode: "narrative",
    visualStyle: "memphis",
    colorScheme: "warm-paper",
    readingMode: "presentation",
  }),
};

export function resolveBrandProfileDesignSystem(input: BrandProfileV2): DesignSystemV2 {
  const profile = brandProfileV2Schema.parse(input);
  const base = PERSONA_SYSTEMS[profile.persona];
  return designSystemV2Schema.parse({
    ...base,
    ...profile.designOverrides,
    colors: profile.designOverrides.colors
      ? { ...(base.colors ?? {}), ...profile.designOverrides.colors }
      : base.colors,
  });
}

export function parseBrandProfile(input: unknown): BrandProfileV2 {
  return brandProfileV2Schema.parse(input);
}
