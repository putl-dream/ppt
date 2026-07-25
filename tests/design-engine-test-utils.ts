import {
  DEFAULT_DESIGN_SYSTEM,
  designSystemV2Schema,
  resolveSlideStyle,
  type DesignSystemV2,
  type SlideDesignOverride,
} from "@design-system";
import type { Presentation, Slide } from "../src/shared/presentation";
import { createLockedLayoutChoice } from "../src/shared/layout-preference";

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
  slide: Pick<Slide, "layout" | "slideVariant" | "designOverride"> = {},
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

export function testLayoutChoice(designSystem: DesignSystemV2 = TEST_DESIGN_SYSTEM) {
  return createLockedLayoutChoice({
    audience: "Test audience",
    objective: "Verify the presentation workflow",
    desiredOutcome: "Produce an executable design plan",
    coreMessage: "The confirmed direction is the design source of truth",
    deliveryContext: "Automated test",
    afterUse: "Regression verification",
  }, designSystem, "Deterministic locked direction for tests.");
}
