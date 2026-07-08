# Renderer Styles

`../styles.css` is the public stylesheet entry. Keep it as an ordered import map so the renderer import in `main.tsx` stays stable.

## Tokens

- `tokens/fonts.css`: external font import.
- `tokens/theme.css`: light and dark theme primitives, including surface, text, border, shadow, font, and palette values.
- `tokens/personalization.css`: semantic user-facing aliases for accent color and component shape.

Accent presets can be switched by setting `data-accent` to `cyan`, `green`, `purple`, or `orange` on a high-level element such as `html` or `body`.

Control shape presets can be switched with `data-control-shape="sharp"`, `soft`, or `round`.

## Modules

`modules/` is split by UI area. Add new selectors to the narrowest matching module first. If a color, radius, font, or transition needs to be reused or user-customized, add a semantic token instead of hard-coding it in a module.
