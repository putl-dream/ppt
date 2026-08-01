import type { Presentation } from "./presentation";

/** Commercial asset license check for SVG page resources. */
export function hasUnverifiedCommercialAssets(presentation: Presentation): boolean {
  return presentation.slides.some((slide) =>
    (slide.visualSource?.resources ?? []).some((resource) => {
      // Resources currently carry path/hash metadata only. Treat remote-looking
      // source paths as unverified; local assets/** are considered verified.
      return resource.sourcePath.startsWith("http://")
        || resource.sourcePath.startsWith("https://");
    })
  );
}
