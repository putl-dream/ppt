# Renderer Styles

`../styles.css` is the public stylesheet entry. Keep it as an ordered import map so the renderer import in `main.tsx` stays stable.

## Layers

| Layer | Path | Role |
|-------|------|------|
| Primitives | `tokens/primitives.css` | Raw color ramps (`--raw-*`). Never use in modules. |
| Typography | `tokens/typography.css` | Type scale + font weights (`--text-*`, `--font-weight-*`) |
| Motion | `tokens/motion.css` | Durations, easing, named transitions |
| Semantic | `tokens/semantic.css` | Contract names modules may consume |
| Skins | `tokens/skins/` | Maps primitives → semantic for each skin × color-scheme |
| Fonts | `tokens/fonts.css` | Inter Variable (UI), Lora (slide serif), JetBrains Mono |
| Components | `components/` | Shared chrome (`.ide-*`, `.toggle-switch`) |
| Modules | `modules/` | Area styles; one concern per file |

**Dependency direction:** `module → component → semantic ← skin ← primitives`. Modules must not read `--raw-*` or invent per-page theme variables.

Workbench UI tokens are separate from the Presentation deck design system under `src/design-system/` — do not merge them.

## Skin × color-scheme (dual axis)

Appearance is applied by `useAppearanceRuntime` on `document.documentElement`:

- `dataset.skin` — currently only `studio`
- `dataset.colorScheme` — `light` \| `dark`
- `dataset.accent` / `dataset.controlShape` — accent + radius family
- `style.colorScheme` — native form controls / scrollbars

**Do not** use `.dark-theme` or UI-level `[data-theme]` for workbench appearance.
Deck layout chips may still use `data-theme="ocean|midnight|…"` — that is the presentation design-system axis, not workbench UI theme.

To add a future **document** skin: create `tokens/skins/document.css`, add `"document"` to `UiSkin`, and leave modules unchanged.

Default: `skin=studio`, `colorScheme=dark`.

## Placement: three questions

1. **Design decision or layout detail?** Semantics → token/skin. Area-only layout → module.
2. **Second call site reuse the structure?** Yes → component. No → stay in module (extract on the third copy).
3. **Who owns correctness?** If unclear, the file boundary is wrong.

## File size is an architecture smell

When a module stays above ~400–600 lines and covers multiple concerns, split into `area-*` siblings preserving cascade order.

## Studio surfaces (dark)

Ordered by **elevation, not lightness**: `canvas < base < raised < sunken < overlay`.
In a dark skin every step above `raised` gets lighter, so `sunken` reads as a mild
lift on a page and as a recess inside an `overlay` card. Never give `sunken` a value
darker than `raised` in a near-black skin — that turns every input into a black hole.

| Token | Role |
|-------|------|
| `--surface-canvas` | Window chrome / app background |
| `--surface-base` | Titlebar + sidebar (continuous chrome) |
| `--surface-raised` | Floating main canvas, settings page |
| `--surface-sunken` | Inputs, code blocks, inset controls |
| `--surface-overlay` | Composer, cards on a page, menus |
| `--elevation-1/2/3` | Soft depth (prefer over hard borders) |

## Typography scale

`--text-2xs` … `--text-2xl` with matching `--text-*-lh`. Weights: **400 / 500 / 600 / 700 only** (Inter Variable). Do not use 520/550/650 fake weights.

## Motion

Prefer `var(--transition-color)` / `var(--transition-panel)` / property-specific transitions. Never `transition: all`.

## Components

- `components/ide.css` — settings chrome vocabulary
- `components/controls.css` — shared `.toggle-switch`
- `components/select.css` — shared Cursor-style `.ui-select` (portal menu)

## Modules ownership

| Module | Owns |
|--------|------|
| `base` / `layout` | shell, titlebar, outer grid, floating canvas inset |
| `sidebar` | workbench left rail |
| `chat` / `chat-*` | conversation stream, agent run, process trace, team |
| `canvas-chrome` / `canvas-mirror` | mirror panel chrome (not slide content) |
| `unified-input` | composer |
| `settings-*` | settings page |
| `review-*` | approvals, artifacts, shared surfaces |
| `model-management` / `project-files` / … | feature-specific |

## Naming

- Area prefix: `chat-`, `ide-`, `settings-`, `mirror-`, …
- State: `is-*` (prefer over bare `.active`)
- Variants: `--` modifier (`message-action-btn--primary`)
