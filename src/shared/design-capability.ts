/**
 * Shared prompt contract for presentation design collaborators.
 *
 * The decision model is adapted from PPT Master's MIT-licensed Strategist,
 * mode, and visual-style catalogs (Copyright 2025-2026 Hugo He). Rendering
 * remains native to this repository's Presentation model.
 */
export const DESIGN_CAPABILITY_VERSION = "ppt-master-design-v2";

/** SVG-native authoring contract shared by teammate prompts and design guidance. */
export const LAYOUT_PLANNER_CONTRACT = `
Design capability: ${DESIGN_CAPABILITY_VERSION}

- Treat argument mode (how the deck argues) and visual style (how it looks) as
  independent deck-wide decisions.
- Start from the communication contract: audience, objective, desired outcome,
  core message, delivery context, and after-use.
- Before writing design/design-spec.json, call ResolveProjectTemplate with the
  communication signals (and any explicit visualStyle the user named). Copy the
  returned designSystem and resolvedTemplate into the design-spec. Do not invent
  template ids or override the resolved visualStyle.
- Uploaded templates are design-reference only: regenerate SVG pages; never claim
  PowerPoint master/placeholder fidelity.
- When the user has not named a style, rely on ResolveProjectTemplate (auto /
  default / custom policy). Do not ask the user to pick among internal
  design-candidate menus (for example safe / shifted / bold labels) unless they
  explicitly ask to compare alternatives.
- When the user explicitly names a style or brand direction, pass it to
  ResolveProjectTemplate as explicitVisualStyle / explicitTemplateId and lock the
  returned system; do not ask them to choose again.
- Lock deck-wide decisions in design/design-spec.json and per-page intent in
  slides/page-plan.json before writing page SVG.
- Every slide must state audienceMove, rhythm (anchor/dense/breathing), and
  layoutIntent in the page plan. Author each page as a complete 1280×720 SVG
  under slides/svg/*.svg.
- Content is frozen while composing SVG pages. Do not add, remove, reorder, or
  rewrite slide content without an explicit lead instruction.
- Use breathing pages deliberately. Do not turn the whole deck into a uniform
  rounded-card grid.
- For image-heavy pages, teammates may call web_search with include_images=true;
  the lead uses SearchSlideImages / WebSearch. Localize assets into the
  workspace and embed them in the page SVG. Keep source metadata; never claim
  unverified licensing.
- Preview each page with PreviewSvgPage. Only the lead submits the deck with
  SubmitSvgDeck after locks and previews match.
`.trim();
