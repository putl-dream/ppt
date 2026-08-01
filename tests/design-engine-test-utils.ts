import {
  DEFAULT_DESIGN_SYSTEM,
  designSystemV2Schema,
  resolveSlideStyle,
  type DesignSystemV2,
  type SlideDesignOverride,
} from "@design-system";
import type { Presentation } from "../src/shared/presentation";

export const TEST_DESIGN_SYSTEM = DEFAULT_DESIGN_SYSTEM;

export type TestDesignSystemOverrides = Partial<Omit<DesignSystemV2, "version">>;

export function testDesignSystem(
  overrides: TestDesignSystemOverrides = {},
): DesignSystemV2 {
  return designSystemV2Schema.parse({
    ...DEFAULT_DESIGN_SYSTEM,
    ...overrides,
    ...(overrides.colors
      ? { colors: { ...(DEFAULT_DESIGN_SYSTEM.colors ?? {}), ...overrides.colors } }
      : {}),
  });
}

export function testSlideStyle(
  slide: { slideVariant?: "light" | "dark" | "hero"; designOverride?: SlideDesignOverride } = {},
  systemOverrides: TestDesignSystemOverrides = {},
  designOverride?: SlideDesignOverride,
) {
  return resolveSlideStyle(testDesignSystem(systemOverrides), {
    ...slide,
    designOverride: designOverride ?? slide.designOverride,
  });
}

export function testPresentation(
  input: Omit<Presentation, "designSystem"> & { designSystem?: DesignSystemV2 },
): Presentation {
  return {
    ...input,
    designSystem: input.designSystem ?? TEST_DESIGN_SYSTEM,
  } as Presentation;
}
