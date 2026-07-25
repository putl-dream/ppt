/**
 * Shared prompt contract for the presentation design planner.
 *
 * The decision model is adapted from PPT Master's MIT-licensed Strategist,
 * mode, and visual-style catalogs (Copyright 2025-2026 Hugo He). Rendering
 * remains native to this repository's Presentation model.
 */
export const DESIGN_CAPABILITY_VERSION = "ppt-master-design-v2";

export const DESIGN_DIRECTION_TIERS = ["safe", "shifted", "bold"] as const;
export const PAGE_RHYTHMS = ["anchor", "dense", "breathing"] as const;

export type DesignDirectionTier = (typeof DESIGN_DIRECTION_TIERS)[number];
export type PageRhythm = (typeof PAGE_RHYTHMS)[number];

export const LAYOUT_PLANNER_CONTRACT = `
Design capability: ${DESIGN_CAPABILITY_VERSION}

- Treat argument mode (how the deck argues) and visual style (how it looks) as
  independent deck-wide decisions.
- Start from the communication contract: audience, objective, desired outcome,
  core message, delivery context, and after-use.
- When the user has not named a style, produce exactly three coherent design
  directions: safe, shifted, and bold. A direction is a complete combination,
  not a list of unrelated tokens.
- When the user explicitly names a style or brand direction, lock it directly;
  do not ask them to choose again.
- ResolveDesignPlan produces candidates and a recommendedDirectionId. Only a
  confirmed slides/layout-choice.json may provide selectedDirectionId.
- Every slide must state audienceMove, rhythm (anchor/dense/breathing), and
  layoutIntent before selecting layout and grammarVariant.
- Content is frozen during layout planning. Keep one plan entry per current
  slide and never add, remove, reorder, or rewrite slide content.
- Use breathing pages deliberately. Do not turn the whole deck into a uniform
  rounded-card grid.
- Any image-grid or case/evidence composition must use web_search with
  include_images=true and emit a real, unique insert-image enhancement with
  source metadata. Text and numeric evidence stay native and editable.
- Read the confirmed choice and write only slides/layout-plan.json. Execution happens later through
  ExecuteLayoutPlan and the CommitGate.
`.trim();
