import {
  DEFAULT_DESIGN_SYSTEM,
  resolveSlideStyle,
  type DesignSystemV1,
  type SlideDesignOverride,
} from "@design-system";
import type { Presentation, Slide } from "../src/shared/presentation";

export const TEST_DESIGN_SYSTEM = DEFAULT_DESIGN_SYSTEM;

export function testDesignSystem(
  tokens: Partial<DesignSystemV1["tokens"]> = {},
): DesignSystemV1 {
  return {
    version: 1,
    tokens: { ...DEFAULT_DESIGN_SYSTEM.tokens, ...tokens },
  };
}

export function testSlideStyle(
  slide: Pick<Slide, "layout" | "slideVariant" | "designOverride"> = {},
  tokens: Partial<DesignSystemV1["tokens"]> = {},
  designOverride?: SlideDesignOverride,
) {
  return resolveSlideStyle(testDesignSystem(tokens), { ...slide, designOverride: designOverride ?? slide.designOverride });
}

export function testPresentation(
  input: Omit<Presentation, "designSystem"> & { designSystem?: DesignSystemV1 },
): Presentation {
  return { ...input, designSystem: input.designSystem ?? TEST_DESIGN_SYSTEM };
}
