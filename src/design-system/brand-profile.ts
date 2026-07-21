import { z } from "zod";

import {
  designSystemV1Schema,
  slideDesignOverrideSchema,
  type DesignSystemV1,
} from "./schema";

export const BRAND_PERSONAS = [
  "consulting",
  "financial-editorial",
  "product-technology",
  "brand-launch",
  "academic-report",
  "youth-consumer",
] as const;

export const brandProfileV1Schema = z.object({
  version: z.literal(1),
  brandName: z.string().trim().min(1).max(80),
  persona: z.enum(BRAND_PERSONAS),
  audience: z.string().trim().min(1).max(120),
  attributes: z.array(z.string().trim().min(1).max(40)).min(2).max(6),
  avoid: z.array(z.string().trim().min(1).max(80)).max(8),
  tokenOverrides: slideDesignOverrideSchema.default({}),
}).strict();

export type BrandPersona = (typeof BRAND_PERSONAS)[number];
export type BrandProfileV1 = z.infer<typeof brandProfileV1Schema>;

export const DEFAULT_BRAND_PROFILE: BrandProfileV1 = {
  version: 1,
  brandName: "未命名品牌",
  persona: "consulting",
  audience: "业务决策者",
  attributes: ["可信", "清晰", "克制"],
  avoid: ["无意义装饰", "低对比度正文"],
  tokenOverrides: {},
};

const PERSONA_SYSTEMS: Record<BrandPersona, DesignSystemV1> = {
  consulting: {
    version: 1,
    tokens: {
      palette: "mono-report", fontMood: "formal", shapeLanguage: "editorial",
      backgroundStyle: "clean", motif: "chapter-number", density: "dense",
      imageTreatment: "framed", chartStyle: "report",
    },
  },
  "financial-editorial": {
    version: 1,
    tokens: {
      palette: "warm-paper", fontMood: "editorial", shapeLanguage: "annotation",
      backgroundStyle: "paper", motif: "margin-note", density: "standard",
      imageTreatment: "captioned", chartStyle: "editorial",
    },
  },
  "product-technology": {
    version: 1,
    tokens: {
      palette: "tech-dark", fontMood: "technical", shapeLanguage: "path",
      backgroundStyle: "dark", motif: "path-line", density: "standard",
      imageTreatment: "masked", chartStyle: "dashboard",
    },
  },
  "brand-launch": {
    version: 1,
    tokens: {
      palette: "business-blue", fontMood: "editorial", shapeLanguage: "geometric",
      backgroundStyle: "gradient", motif: "arc", density: "calm",
      imageTreatment: "masked", chartStyle: "editorial",
    },
  },
  "academic-report": {
    version: 1,
    tokens: {
      palette: "soft-academic", fontMood: "formal", shapeLanguage: "annotation",
      backgroundStyle: "grid", motif: "bookmark", density: "calm",
      imageTreatment: "captioned", chartStyle: "report",
    },
  },
  "youth-consumer": {
    version: 1,
    tokens: {
      palette: "warm-paper", fontMood: "warm", shapeLanguage: "geometric",
      backgroundStyle: "gradient", motif: "arc", density: "standard",
      imageTreatment: "masked", chartStyle: "minimal",
    },
  },
};

export function resolveBrandProfileDesignSystem(input: BrandProfileV1): DesignSystemV1 {
  const profile = brandProfileV1Schema.parse(input);
  const base = PERSONA_SYSTEMS[profile.persona];
  return designSystemV1Schema.parse({
    version: 1,
    tokens: { ...base.tokens, ...profile.tokenOverrides },
  });
}

export function parseBrandProfile(input: unknown): BrandProfileV1 {
  return brandProfileV1Schema.parse(input);
}
