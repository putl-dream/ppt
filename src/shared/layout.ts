import type { Slide, SlideElement, TextElement, ShapeElement, ImageElement } from "./presentation";
import type { SlideLayoutType } from "./slide-layouts";
import type { ResolvedSlideStyle, SlideDesignOverride } from "@design-system";
import type { TextRole } from "./typography";
import { resolveLayoutBackgroundVariant, type BackgroundVariant } from "./slide-background";
import { isUserPreservedShape } from "./layout-shape-utils";
import "./layout-register-builtin";
import "./layout-handlers/cover";
import "./layout-handlers/section";
import "./layout-handlers/process";
import "./layout-handlers/architecture";
import "./layout-handlers/case";
import "./layout-handlers/image-grid";
import "./layout-handlers/toc";
import "./layout-handlers/concept";
import "./layout-handlers/comparison";
import "./layout-handlers/quote";
import "./layout-handlers/summary";
import { layoutRegistry } from "./layout-registry";
import { layoutGrammarRegistry } from "./layout-grammar";

export { estimateTextWidthUnits, fitFontSize } from "./layout-text-fit";

const generateId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 15);
};

export function applyLayout(
  slide: Slide,
  layout: SlideLayoutType,
  style: ResolvedSlideStyle,
  options: {
    grammarVariant?: string;
    designOverride?: SlideDesignOverride;
  } = {},
): Slide {
  const workingSlide = structuredClone(slide);
  const colors = style.colors;
  const grammarVariant = options.grammarVariant ?? slide.grammarVariant;

  // Separate elements by type
  let textElements = workingSlide.elements.filter((el): el is TextElement => el.type === "text");
  const imageElements = workingSlide.elements.filter((el) => el.type === "image");
  const dataElements = workingSlide.elements.filter(
    (el) => el.type === "chart" || el.type === "table" || el.type === "icon",
  );
  
  // Keep user-added shapes (lines, circles, arrows) — not layout-generated cards/badges.
  const userShapes = workingSlide.elements.filter(isUserPreservedShape);

  if (textElements.length === 0 && layout !== "image-grid") {
    const defaultBackgroundVariant = (
      layoutRegistry.get(layout)?.defaultBackgroundVariant
      ?? resolveLayoutBackgroundVariant(layout)
    ) as BackgroundVariant;
    return {
      ...workingSlide,
      layout,
      grammarVariant,
      designOverride: options.designOverride ?? slide.designOverride,
      backgroundVariant: defaultBackgroundVariant,
      slideVariant: slide.slideVariant ?? layoutRegistry.get(layout)?.defaultSlideVariant,
    };
  }

  const isChromeLayout = layout === "cover" || layout === "section";
  const normalizedTitle = workingSlide.title.trim();

  // Drop canvas text that duplicates the chrome header title on content slides.
  if (!isChromeLayout) {
    textElements = textElements.filter(
      (el) => el.text.trim() !== normalizedTitle,
    );
  }

  const titleEl = isChromeLayout && textElements.length > 0
    ? textElements.find(
        (el) => el.text.trim() === normalizedTitle || el.fontSize >= 36,
      )
    : undefined;

  const bodyTexts = titleEl
    ? textElements.filter((el) => el.id !== titleEl.id)
    : textElements;
  const elements: SlideElement[] = [];

  const shapeShadow = (
    opacityScale = 1,
  ): ShapeElement["shadow"] => {
    if (!style.shape.shadow) return undefined;
    const source = style.catalog.elevation.shadow;
    if (!source) return undefined;
    return {
      color: style.shape.elevation === "glow" ? colors.accent : colors.scrim,
      blur: source.blur,
      offsetX: source.x,
      offsetY: source.y,
      opacity: Math.min(1, source.opacity * opacityScale),
    };
  };
  const shapeStroke = style.shape.stroke.width > 0
    ? style.shape.stroke.color
    : "transparent";
  const shapeTypeForRadius = (
    radius: number,
  ): ShapeElement["shapeType"] => radius > 0 ? "roundedRect" : "rectangle";

  const createCard = (x: number, y: number, w: number, h: number): ShapeElement => {
    const radius = Math.max(0, style.shape.radius);
    return {
      id: `card-${generateId()}`,
      type: "shape",
      shapeType: shapeTypeForRadius(radius),
      x,
      y,
      width: w,
      height: h,
      fillColor: colors.cardBg,
      strokeColor: shapeStroke,
      cornerRadius: radius,
      fillOpacity: style.catalog.texture.kind === "frosted-glass" ? 0.72 : undefined,
      shadow: shapeShadow(),
      provenance: "layout",
    };
  };

  const createAccentBlock = (
    x: number,
    y: number,
    w: number,
    h: number,
    opts: { opacity?: number; radius?: number } = {},
  ): ShapeElement => {
    const radius = Math.max(
      0,
      opts.radius == null
        ? style.shape.radius
        : Math.min(opts.radius, style.shape.radius),
    );
    return {
      id: `accent-${generateId()}`,
      type: "shape",
      shapeType: shapeTypeForRadius(radius),
      x,
      y,
      width: w,
      height: h,
      fillColor: colors.accent,
      strokeColor: shapeStroke,
      cornerRadius: radius,
      fillOpacity: opts.opacity ?? 0.15,
      shadow: w > 12 && h > 12 ? shapeShadow(0.65) : undefined,
      provenance: "layout",
    };
  };

  const createAccentBar = (x: number, y: number, w: number): ShapeElement =>
    createAccentBlock(x, y, w, 6, { opacity: 1, radius: style.shape.radius });

  const createStepBadge = (x: number, y: number, size: number): ShapeElement => ({
    id: `badge-${generateId()}`,
    type: "shape",
    shapeType: "circle",
    x,
    y,
    width: size,
    height: size,
    fillColor: colors.accent,
    strokeColor: shapeStroke,
    shadow: shapeShadow(0.65),
    provenance: "layout",
  });

  const createProcessArrow = (x: number, y: number, w: number, h: number): ShapeElement => ({
    id: `arrow-${generateId()}`,
    type: "shape",
    shapeType: "arrow",
    x,
    y,
    width: w,
    height: h,
    fillColor: colors.accent,
    strokeColor: shapeStroke,
    provenance: "layout",
  });

  const placedImageIds = new Set<string>();
  const placedDataIds = new Set<string>();

  const assignTextRole = (el: TextElement, role: TextRole): TextElement => {
    const typography = role === "kicker"
      ? style.typography.heading
      : role === "metric"
        ? style.typography.data
        : style.typography.body;
    return {
      ...el,
      textRole: role,
      fontFamily: typography.family,
    };
  };

  const placeImageInSlot = (
    image: ImageElement,
    rect: { x: number; y: number; width: number; height: number },
    slotName: string,
  ): ImageElement => {
    placedImageIds.add(image.id);
    return {
      ...image,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      imageSlot: slotName,
      objectFit: image.objectFit ?? "cover",
    };
  };

  const pickImageForSlot = (
    slotName: string,
    fallbackUnslottedOnly = false,
  ): ImageElement | undefined => {
    const slotted = imageElements.find((img) => img.imageSlot === slotName);
    if (slotted) return slotted;
    if (fallbackUnslottedOnly) {
      return imageElements.find((img) => !img.imageSlot && !placedImageIds.has(img.id));
    }
    return undefined;
  };

  const placeDataInSlot = <T extends (typeof dataElements)[number]>(
    element: T,
    rect: { x: number; y: number; width: number; height: number },
  ): T => {
    placedDataIds.add(element.id);
    return { ...element, ...rect };
  };

  const grammarHandler = layoutGrammarRegistry.get(layout);
  let appliedGrammarVariant = grammarVariant;
  if (grammarHandler) {
    appliedGrammarVariant = grammarHandler.apply({
      slide: workingSlide,
      style,
      colors,
      textElements,
      imageElements,
      dataElements,
      userShapes,
      titleEl,
      bodyTexts,
      elements,
      placedImageIds,
      placedDataIds,
      helpers: {
        createCard,
        createAccentBlock,
        createAccentBar,
        createStepBadge,
        createProcessArrow,
        assignTextRole,
        placeImageInSlot,
        pickImageForSlot,
        placeDataInSlot,
      },
      grammarVariant,
    }) ?? grammarVariant ?? grammarHandler.defaultVariant;
  }

  // Re-append unplaced images, custom user shapes, and data/icon elements
  const remainingImages = imageElements.filter((img) => !placedImageIds.has(img.id));
  const userDataElements = workingSlide.elements.filter(
    (el) => el.type === "chart" || el.type === "table" || el.type === "icon",
  ).filter((element) => !placedDataIds.has(element.id));
  elements.push(...remainingImages);
  elements.push(...userShapes);
  elements.push(...userDataElements);

  const defaultBackgroundVariant = (layoutRegistry.get(layout)?.defaultBackgroundVariant ??
    resolveLayoutBackgroundVariant(layout)) as BackgroundVariant;
  const backgroundVariant = defaultBackgroundVariant;

  return {
    ...workingSlide,
    layout,
    grammarVariant: appliedGrammarVariant,
    designOverride: options.designOverride ?? slide.designOverride,
    backgroundVariant,
    slideVariant: slide.slideVariant ?? layoutRegistry.get(layout)?.defaultSlideVariant,
    elements,
  };
}
