import type { Presentation } from "./presentation";

export function hasUnverifiedCommercialAssets(presentation: Presentation): boolean {
  return presentation.slides.some((slide) => slide.elements.some((element) =>
    element.type === "image"
    && element.provenance === "asset"
    && Boolean(element.asset?.sourceUrl)
    && (element.asset?.licenseStatus ?? "unknown") === "unknown"
  ));
}
