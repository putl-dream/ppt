export const DEFAULT_UI_THEME_ID = "studio";
export const CATNIP_UI_THEME_ID = "catnip";

export interface BuiltinUiTheme {
  id: string;
  name: string;
}

export const BUILTIN_UI_THEMES: readonly BuiltinUiTheme[] = [
  { id: DEFAULT_UI_THEME_ID, name: "Studio" },
  { id: CATNIP_UI_THEME_ID, name: "Catnip 猫娘" },
];

export const BUILTIN_UI_THEME_IDS = new Set(
  BUILTIN_UI_THEMES.map((theme) => theme.id),
);
