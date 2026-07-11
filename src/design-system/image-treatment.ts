import type { ImageTreatment } from "./schema";

export interface ResolvedImageTreatment {
  treatment: ImageTreatment;
  borderRadius: number;
  borderWidth: number;
  padding: number;
  backgroundColor: string;
  borderColor: string;
  boxShadow?: string;
}

export function resolveImageTreatment(
  requested: ImageTreatment | undefined,
  fallback: ImageTreatment,
  borderRadius: number | undefined,
  colors: { cardBg: string; cardStroke: string },
): ResolvedImageTreatment {
  const treatment = requested ?? fallback;
  const explicitRadius = borderRadius ?? 0;
  if (treatment === "masked") {
    return { treatment, borderRadius: Math.max(explicitRadius, 9999), borderWidth: 0, padding: 0, backgroundColor: "transparent", borderColor: "transparent" };
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
  return { treatment, borderRadius: explicitRadius, borderWidth: 0, padding: 0, backgroundColor: "transparent", borderColor: "transparent" };
}
