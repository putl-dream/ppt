import type { ImageElement } from "./presentation";
import type { ImageTreatment } from "./design-tokens";

export interface ResolvedImageTreatmentStyle {
  treatment: ImageTreatment;
  borderRadius: number;
  borderWidth: number;
  padding: number;
  backgroundColor: string;
  borderColor: string;
  boxShadow?: string;
}

export function resolveImageTreatmentStyle(
  element: Pick<ImageElement, "imageTreatment" | "borderRadius">,
  fallback: ImageTreatment = "plain",
  colors: { cardBg: string; cardStroke: string } = {
    cardBg: "#ffffff",
    cardStroke: "#e2e8f0",
  },
): ResolvedImageTreatmentStyle {
  const treatment = element.imageTreatment ?? fallback;
  const explicitRadius = element.borderRadius ?? 0;

  if (treatment === "masked") {
    return {
      treatment,
      borderRadius: Math.max(explicitRadius, 9999),
      borderWidth: 0,
      padding: 0,
      backgroundColor: "transparent",
      borderColor: "transparent",
    };
  }

  if (treatment === "framed" || treatment === "captioned") {
    return {
      treatment,
      borderRadius: Math.max(explicitRadius, 12),
      borderWidth: 1,
      padding: treatment === "captioned" ? 10 : 8,
      backgroundColor: colors.cardBg,
      borderColor: colors.cardStroke,
      boxShadow: "0 8px 24px rgba(15, 23, 42, 0.12)",
    };
  }

  return {
    treatment,
    borderRadius: explicitRadius,
    borderWidth: 0,
    padding: 0,
    backgroundColor: "transparent",
    borderColor: "transparent",
  };
}
