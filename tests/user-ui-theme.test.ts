// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  applyUserUiThemeCss,
  BUILTIN_UI_THEME_ID,
  normalizePersistedUiThemeId,
  USER_UI_THEME_STYLE_ID,
} from "../src/renderer/src/app/userUiTheme";

describe("user UI theme helpers", () => {
  afterEach(() => {
    document.getElementById(USER_UI_THEME_STYLE_ID)?.remove();
  });

  it("normalizes missing or invalid persisted ids to studio", () => {
    expect(normalizePersistedUiThemeId(undefined)).toBe(BUILTIN_UI_THEME_ID);
    expect(normalizePersistedUiThemeId("")).toBe(BUILTIN_UI_THEME_ID);
    expect(normalizePersistedUiThemeId("studio")).toBe(BUILTIN_UI_THEME_ID);
  });

  it("keeps custom ids until an availability set proves they are gone", () => {
    expect(normalizePersistedUiThemeId("midnight")).toBe("midnight");
    expect(
      normalizePersistedUiThemeId("midnight", new Set(["example"])),
    ).toBe(BUILTIN_UI_THEME_ID);
    expect(
      normalizePersistedUiThemeId("example", new Set(["example"])),
    ).toBe("example");
  });

  it("injects and removes the user theme style element", () => {
    applyUserUiThemeCss(":root { --surface-canvas: #010203; }");
    const injected = document.getElementById(USER_UI_THEME_STYLE_ID);
    expect(injected).toBeInstanceOf(HTMLStyleElement);
    expect(injected?.textContent).toContain("--surface-canvas");

    applyUserUiThemeCss(":root { --surface-canvas: #abcdef; }");
    expect(document.querySelectorAll(`#${USER_UI_THEME_STYLE_ID}`)).toHaveLength(1);
    expect(document.getElementById(USER_UI_THEME_STYLE_ID)?.textContent).toContain("#abcdef");

    applyUserUiThemeCss(null);
    expect(document.getElementById(USER_UI_THEME_STYLE_ID)).toBeNull();
  });
});
