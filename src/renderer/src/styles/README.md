# Renderer Styles

`../styles.css` is the public stylesheet entry. Keep it as an ordered import map so the renderer import in `main.tsx` stays stable.

## Layers

| Layer | Path | Role |
|-------|------|------|
| Tokens | `tokens/` | Primitives only: theme, fonts, personalization, IDE density vars |
| Components | `components/` | Shared chrome vocabulary reused across areas (e.g. `ide.css`, `controls.css`) |
| Modules | `modules/` | UI-area styles; one concern per file (or `area-*` siblings) |

Workbench UI tokens (Graphite) are separate from the Presentation deck design system under `src/design-system/` — do not merge them.

**Dependency direction:** `module → component → token`. Tokens and components must not depend on a page/area class.

### What “unified CSS” means here

Unify **design decisions** (color, type, space, radius, density), not every selector in one physical pile.

- Shared **semantics** → tokens
- Shared **structure/interaction vocabulary** reused across areas → components (prefer few)
- Area-specific layout and state → modules owned by that UI

Page-local full stylesheets are the wrong end-state for theming. A single mega-folder without ownership is also wrong. Prefer: one theme source + clear area ownership.

## Placement: three questions

Before adding or moving a rule, answer:

1. **Design decision or layout detail?**  
   Color / type scale / spacing scale / radius / shadow semantics → **token**.  
   “This margin only exists for the chat bubble” → **module**.
2. **Will a second call site reuse this structure as-is?**  
   Yes, and it is structural/interactive vocabulary → **component** (e.g. `.ide-row`, `.toggle-switch`).  
   No → keep it in the owning module; do not abstract early. Tolerate two copies; extract on the third.
3. **Who owns correctness?**  
   If the rule breaks, which area/file should a reviewer open? If that answer is unclear, the file boundary is wrong.

## File size is an architecture smell

When a module stays above ~400–600 lines and covers multiple concerns, split by **sub-concern** into sibling files (same pattern as `chat-*.css` / `settings-*.css` / `review-*.css` / `canvas-*.css`). Prefer contiguous splits that preserve cascade order (“split only, no visual change”) over clever reordering.

Do not “fix” sprawl by merging everything into a larger global sheet.

## Tokens

- `tokens/fonts.css`: external font import (`--font-display`, `--font-body`, `--font-serif`, `--font-mono`).
- `tokens/theme.css`: light/dark primitives — surfaces (first-paint fallbacks), text, border, semantic status (`--danger` / `--success` / `--warning` + glow/border), accent palette, spacing (`--space-*`), radius bases (`--radius-*`), z-index, transitions.
- `tokens/personalization.css`: user-facing aliases for accent and control shape (`--accent-primary`, `--control-radius-*`).
- `tokens/ide-density.css`: IDE density variables only (`--ide-font-ui`, `--ide-row-height`, …).

### Surface backgrounds (single author)

`--bg-app`, `--bg-canvas`, `--bg-glass`, `--bg-input-field`, and `--bg-darker` are written at runtime by `useAppearanceRuntime` from `data-reading-tone` + contrast offset. `theme.css` keeps light first-paint fallbacks and must **not** redefine these on `.dark-theme` (so `:root` inline values inherit into `.app-shell`).

### Semantic colors

Prefer tokens over hex:

- `--text-primary`, `--text-secondary`, `--text-muted`, `--text-on-accent`
- `--danger`, `--danger-glow`, `--danger-border`
- `--success`, `--success-glow`, `--success-border`
- `--warning`, `--warning-glow`, `--warning-border`
- `--diff-remove`, `--diff-add` (patch review line foregrounds)
- `--border-subtle`

Leave literals when they are intentional fixed surfaces (e.g. slide thumbnails / theme-picker swatches that must stay light regardless of workbench theme).

### Accent / shape switches

- `data-accent` = `cyan` | `green` | `orange` (`purple` legacy → cyan)
- `data-control-shape` = `sharp` | `soft` | `round`

## Components

- `components/ide.css`: shared `.ide-page`, `.ide-row`, `.ide-choice`, … vocabulary. Settings and other preference UIs consume these classes.
- `components/controls.css`: shared `.toggle-switch` / `.toggle-slider` (settings, logs, model management).

Keep this layer thin. New shared classes belong here only after real cross-area reuse (see question 2). Area-specific overrides (e.g. `.cursor-model-toggle` sizing/colors) stay in the owning module.

## Modules

Add new selectors to the narrowest matching module. Import order in `styles.css` is part of the contract (later rules may override earlier ones intentionally).

| Module | Owns |
|--------|------|
| `base` / `layout` | shell, panel skeleton |
| `sidebar` | left rail |
| `chat` / `chat-*` | conversation stream, markdown, agent run, process trace, team (not mirror) |
| `canvas-chrome` | canvas column header, slide navigator, viewport chrome |
| `canvas-mirror` | PPT mirror / presentation preview workspace |
| `unified-input` | composer / lower deck |
| `settings-nav` | settings sidebar nav, back-to-workspace, early settings chrome overrides |
| `settings-panels` | settings page shell, cards, profile/stats blocks |
| `settings-token-usage` | token usage / activity charts in settings |
| `settings-forms` | settings form rows, logs, appearance pickers, settings responsive rules |
| `overlays-slash` | slash command menu, context chips |
| `overlays-slideshow` | fullscreen slideshow lightbox |
| `review-approvals` | approval cards, tool-approval gate, agent task blocks, patch review |
| `review-artifacts-inline` | inline artifact cards, agent questions, deck preview chrome |
| `review-surfaces` | shared decision/artifact surface language + gallery overrides |
| `model-management` | model catalog / provider UI |
| `project-files` | project file browser |
| `context-menu-thinking` | context menu + thinking affordances |
| `ppt-job-status` | PPT job status chrome |

If a color, radius, space, or transition is reused, add a semantic token instead of hard-coding it in a module. Hard-coded colors in modules are debt: they desync when the theme changes.

## Naming

- Area prefix: `chat-`, `ide-`, `settings-`, `mirror-`, …
- State: `is-*` (prefer over bare `.active`)
- Variants: `--` modifier (`message-action-btn--primary`)
