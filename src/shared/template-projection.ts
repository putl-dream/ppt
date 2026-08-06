import { type DesignSystemV2, designSystemV2Schema } from "@design-system";
import {
  type TemplateAuthoringGuidance,
  type TemplateChrome,
  type TemplateDescriptor,
  type TemplateInheritance,
  type TemplateInspection,
  type TemplatePack,
  type TemplatePackAsset,
  type TemplateTypographyRoles,
  templateAuthoringGuidanceSchema,
  templatePackSchema,
  templateTypographyRolesSchema,
} from "./template-protocol";

function normalizeHex(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^[0-9a-f]{6}$/i.test(trimmed)) return `#${trimmed.toLowerCase()}`;
  if (/^[0-9a-f]{8}$/i.test(trimmed)) {
    // OOXML sometimes stores AARRGGBB — drop alpha.
    return `#${trimmed.slice(2).toLowerCase()}`;
  }
  return undefined;
}

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16) / 255;
  const g = Number.parseInt(value.slice(2, 4), 16) / 255;
  const b = Number.parseInt(value.slice(4, 6), 16) / 255;
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Map common Office typefaces onto stacks available in preview/export. */
const FONT_STACK_MAP: Record<string, string> = {
  arial: '"Arial", "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif',
  calibri: '"Calibri", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  cambria: '"Cambria", "Georgia", "Songti SC", serif',
  georgia: '"Georgia", "Times New Roman", "Songti SC", serif',
  inter: '"Inter", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  "segoe ui": '"Segoe UI", "Inter", "PingFang SC", "Microsoft YaHei", sans-serif',
  "times new roman": '"Times New Roman", "Songti SC", serif',
  "microsoft yahei": '"Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif',
  "pingfang sc": '"PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif',
  "source sans 3": '"Source Sans 3", "Inter", "Segoe UI", sans-serif',
  "noto sans": '"Noto Sans", "Segoe UI", "PingFang SC", sans-serif',
  helvetica: '"Helvetica Neue", "Arial", "PingFang SC", sans-serif',
};

const DEFAULT_SANS = '"Inter", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
const DEFAULT_SERIF = '"Georgia", "Times New Roman", "Songti SC", serif';
const DEFAULT_MONO = '"JetBrains Mono", "Consolas", monospace';

export function mapTypefaceToStack(
  typeface: string | undefined,
  kind: "sans" | "serif" | "mono",
): string {
  if (!typeface) {
    return kind === "serif" ? DEFAULT_SERIF : kind === "mono" ? DEFAULT_MONO : DEFAULT_SANS;
  }
  const key = typeface.trim().toLowerCase();
  if (FONT_STACK_MAP[key]) return FONT_STACK_MAP[key];
  const quoted = typeface.includes('"') ? typeface : `"${typeface}"`;
  if (kind === "mono") return `${quoted}, ${DEFAULT_MONO}`;
  if (kind === "serif") return `${quoted}, ${DEFAULT_SERIF}`;
  return `${quoted}, ${DEFAULT_SANS}`;
}

export function projectDesignReferenceTypography(
  inspection: TemplateInspection,
): TemplateTypographyRoles {
  const major = inspection.fonts.major;
  const minor = inspection.fonts.minor ?? major;
  return templateTypographyRolesSchema.parse({
    title: mapTypefaceToStack(major, "sans"),
    body: mapTypefaceToStack(minor, "sans"),
    emphasis: mapTypefaceToStack(major, "sans"),
    data: DEFAULT_MONO,
    sourceMajor: major,
    sourceMinor: minor,
  });
}

/**
 * Project a PPTX/POTX design-reference inspection into an executable
 * DesignSystemV2. Does not claim master/layout fidelity.
 *
 * When theme extraction is incomplete, still emit a custom scheme using the
 * best available anchors plus documented fallbacks — never silently pretend the
 * import produced a named builtin palette without warnings on the inspection.
 */
export function projectDesignReferenceToDesignSystem(
  inspection: TemplateInspection,
): DesignSystemV2 {
  const colors = inspection.themeColors;
  const background = normalizeHex(colors.lt1) ?? normalizeHex(colors.dk1) ?? "#ffffff";
  const bodyText = normalizeHex(colors.dk1) ?? normalizeHex(colors.lt1) ?? "#111827";
  const primary = normalizeHex(colors.accent1) ?? normalizeHex(colors.dk2) ?? "#2563eb";
  const accent = normalizeHex(colors.accent2) ?? normalizeHex(colors.accent1) ?? primary;
  const secondaryBg = normalizeHex(colors.lt2) ?? background;
  const secondaryAccent = normalizeHex(colors.accent3) ?? accent;

  const darkCanvas = luminance(background) < 0.35;

  return designSystemV2Schema.parse({
    version: 2,
    argumentMode: "pyramid",
    // visualStyle is only a composition-discipline base; colors/fonts/chrome
    // from the pack override builtin look-and-feel at authoring time.
    visualStyle: darkCanvas ? "dark-tech" : "swiss-minimal",
    readingMode: "balanced",
    colorScheme: {
      name: "imported-reference",
      background,
      secondaryBg,
      primary,
      accent,
      secondaryAccent,
      bodyText,
    },
  });
}

export function projectDesignReferenceGuidance(
  inspection: TemplateInspection,
  options?: {
    assets?: TemplatePackAsset[];
    typography?: TemplateTypographyRoles;
    chrome?: TemplateChrome;
  },
): TemplateAuthoringGuidance {
  const masterNames = inspection.masters.map((item) => item.name).slice(0, 4);
  const layoutNames = inspection.layouts.map((item) => item.name).slice(0, 6);
  const fonts = [
    inspection.fonts.major,
    inspection.fonts.minor,
    ...(inspection.fonts.used ?? []),
  ].filter(Boolean);
  const logoPaths = (options?.assets ?? [])
    .filter((asset) => asset.role === "logo" || asset.role === "header")
    .map((asset) => asset.path);
  const mustUse = [
    "Use presentationDesignSystem.colorScheme HEX values verbatim for fills and text.",
    options?.typography
      ? `Use typography roles from the template pack (title/body/emphasis/data).`
      : undefined,
    ...logoPaths.map((path) => `Embed logo via <image href="${path}"> where chrome requires it.`),
    options?.chrome?.header
      ? `Draw header chrome near y=${Math.round(options.chrome.header.y)} height=${Math.round(options.chrome.header.height)}.`
      : undefined,
    options?.chrome?.footer
      ? `Draw footer chrome near y=${Math.round(options.chrome.footer.y)} height=${Math.round(options.chrome.footer.height)}.`
      : undefined,
    options?.chrome?.titleFrame
      ? `Place the primary title inside approx x=${Math.round(options.chrome.titleFrame.x)} y=${Math.round(options.chrome.titleFrame.y)} w=${Math.round(options.chrome.titleFrame.w)} h=${Math.round(options.chrome.titleFrame.h)}.`
      : undefined,
  ].filter((item): item is string => Boolean(item));

  const compositionParts = [
    "Treat the uploaded PPTX/POTX as a design-reference only.",
    "Regenerate every page as complete 1280×720 SVG; do not reuse PowerPoint masters or placeholders.",
    "Do not fall back to a conflicting builtin palette or font stack when the template pack is active.",
    masterNames.length > 0
      ? `Observed masters: ${masterNames.join(", ")}.`
      : "No named masters were detected.",
    layoutNames.length > 0 ? `Observed layouts: ${layoutNames.join(", ")}.` : undefined,
    fonts.length > 0
      ? `Prefer related typography when available: ${[...new Set(fonts)].slice(0, 4).join(", ")}.`
      : undefined,
    inspection.slideSize.aspectRatio
      ? `Source aspect hint: ${inspection.slideSize.aspectRatio} (product canvas remains 16:9 / 1280×720).`
      : undefined,
    options?.chrome?.background?.fill
      ? `Background hint: ${options.chrome.background.kind} ${options.chrome.background.fill}.`
      : undefined,
  ].filter(Boolean);

  return templateAuthoringGuidanceSchema.parse({
    composition: compositionParts.join(" "),
    avoid: [
      "Claiming master or placeholder fidelity",
      "Copying fixed PPT coordinates into SVG",
      "Leaving empty image frames when assets are missing",
      "Ignoring the active template pack colors/fonts/chrome",
      "Calling GetDesignReference and then replacing the pack palette with a builtin look",
      ...inspection.warnings.slice(0, 4),
    ],
    mustUse,
  });
}

export function projectDesignReferenceInheritance(
  inspection: TemplateInspection,
  assets: TemplatePackAsset[],
): TemplateInheritance {
  const hasCustomColors = Boolean(
    normalizeHex(inspection.themeColors.lt1) ||
      normalizeHex(inspection.themeColors.dk1) ||
      normalizeHex(inspection.themeColors.accent1),
  );
  const hasFonts = Boolean(inspection.fonts.major || inspection.fonts.minor);
  const hasLogo = assets.some((asset) => asset.role === "logo" || asset.role === "header");
  const hasHeaderFooter = Boolean(inspection.chrome?.header || inspection.chrome?.footer);
  const hasTitleFrame = Boolean(inspection.chrome?.titleFrame);
  return {
    colors: hasCustomColors,
    fonts: hasFonts ? "preferred" : "none",
    logo: hasLogo,
    headerFooter: hasHeaderFooter,
    titleFrame: hasTitleFrame,
    masters: false,
    placeholders: false,
  };
}

/**
 * Build the executable project pack from a descriptor + inspection + extracted assets.
 */
export function buildTemplatePack(input: {
  descriptor: TemplateDescriptor;
  inspection: TemplateInspection;
  assets?: TemplatePackAsset[];
}): TemplatePack {
  const assets = input.assets ?? [];
  const typography = projectDesignReferenceTypography(input.inspection);
  const chrome = input.inspection.chrome;
  const authoringGuidance = projectDesignReferenceGuidance(input.inspection, {
    assets,
    typography,
    chrome,
  });
  const inheritance = projectDesignReferenceInheritance(input.inspection, assets);
  return templatePackSchema.parse({
    version: 1,
    templateId: input.descriptor.id,
    revisionId: input.descriptor.revisionId,
    name: input.descriptor.name,
    supportLevel: "design-reference",
    designSystem: input.descriptor.designSystem,
    typography,
    chrome,
    assets,
    authoringGuidance,
    inheritance,
    contentHash: input.inspection.contentHash,
    extractedAt: input.inspection.importedAt,
    warnings: input.inspection.warnings,
  });
}
