import type { UiThemeSummary } from "@shared/ipc";
import { BUILTIN_UI_THEMES, DEFAULT_UI_THEME_ID } from "@shared/ui-themes";
import React from "react";
import {
  MAX_UI_FONT_SIZE,
  MAX_UI_LINE_HEIGHT,
  MIN_UI_FONT_SIZE,
  MIN_UI_LINE_HEIGHT,
  normalizePersistedUiFontSize,
  normalizePersistedUiLineHeight,
  type UiFontFamily,
} from "../../app/uiTypography";
import { cx } from "../../lib/cx";
import { MoonIcon, PaletteIcon, SunIcon } from "../Icons";
import { SettingsPanel, SettingsRow, SettingsSection } from "./SettingsPrimitives";

export type UiColorScheme = "light" | "dark" | "system";

const fontFamilyOptions: Array<{ value: UiFontFamily; label: string }> = [
  { value: "system", label: "系统默认" },
  { value: "yahei", label: "微软雅黑" },
  { value: "pingfang", label: "苹方" },
  { value: "segoe", label: "Segoe UI" },
];

const colorSchemeOptions: Array<{
  value: UiColorScheme;
  label: string;
  icon: React.ReactNode;
}> = [
  { value: "dark", label: "暗色", icon: <MoonIcon size={13} /> },
  { value: "light", label: "浅色", icon: <SunIcon size={13} /> },
  { value: "system", label: "跟随系统", icon: <PaletteIcon size={13} /> },
];

export function AppearanceSettingsPanel({
  colorScheme,
  setColorScheme,
  uiThemeId,
  setUiThemeId,
  uiThemes,
  onRefreshUiThemes,
  onOpenUiThemesDirectory,
  uiFontFamily,
  setUiFontFamily,
  uiFontSize,
  setUiFontSize,
  uiLineHeight,
  setUiLineHeight,
}: {
  colorScheme: UiColorScheme;
  setColorScheme: (value: UiColorScheme) => void;
  uiThemeId: string;
  setUiThemeId: (value: string) => void;
  uiThemes: UiThemeSummary[];
  onRefreshUiThemes: () => void;
  onOpenUiThemesDirectory: () => void;
  uiFontFamily: UiFontFamily;
  setUiFontFamily: (value: UiFontFamily) => void;
  uiFontSize: number;
  setUiFontSize: (value: number) => void;
  uiLineHeight: number;
  setUiLineHeight: (value: number) => void;
}) {
  const [fontSizeDraft, setFontSizeDraft] = React.useState(() => String(uiFontSize));
  const [lineHeightDraft, setLineHeightDraft] = React.useState(() => String(uiLineHeight));
  React.useEffect(() => setFontSizeDraft(String(uiFontSize)), [uiFontSize]);
  React.useEffect(() => setLineHeightDraft(String(uiLineHeight)), [uiLineHeight]);

  const themeOptions = [
    ...BUILTIN_UI_THEMES.map((theme) => ({ value: theme.id, label: theme.name })),
    ...uiThemes.map((theme) => ({ value: theme.id, label: theme.name })),
  ];
  const selectedThemeLabel =
    themeOptions.find((option) => option.value === uiThemeId)?.label ??
    (uiThemeId === DEFAULT_UI_THEME_ID ? "Studio" : uiThemeId);
  const selectedSchemeLabel =
    colorSchemeOptions.find((option) => option.value === colorScheme)?.label ?? "暗色";
  const selectedFontFamilyLabel =
    fontFamilyOptions.find((option) => option.value === uiFontFamily)?.label ?? "系统默认";

  const commitFontSize = () => {
    const size = normalizePersistedUiFontSize(fontSizeDraft);
    setFontSizeDraft(String(size));
    if (size !== uiFontSize) setUiFontSize(size);
  };
  const commitLineHeight = () => {
    const lineHeight = normalizePersistedUiLineHeight(lineHeightDraft);
    setLineHeightDraft(String(lineHeight));
    if (lineHeight !== uiLineHeight) setUiLineHeight(lineHeight);
  };

  return (
    <SettingsPanel>
      <p className="ide-hint">只改变软件自身皮肤与控件，不影响导出的演示文档。</p>
      <SettingsSection title="皮肤" hint={selectedThemeLabel}>
        <SettingsRow label="设计语言">
          <div className="ide-choice-group" role="group" aria-label="皮肤">
            {themeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={cx("ide-choice", uiThemeId === option.value && "is-active")}
                onClick={() => setUiThemeId(option.value)}
                aria-pressed={uiThemeId === option.value}
              >
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow label="主题根目录">
          <div className="ide-choice-group" role="group" aria-label="主题根目录操作">
            <button type="button" className="ide-choice" onClick={onOpenUiThemesDirectory}>
              <span>打开主题根目录</span>
            </button>
            <button type="button" className="ide-choice" onClick={onRefreshUiThemes}>
              <span>刷新列表</span>
            </button>
          </div>
        </SettingsRow>
        <p className="ide-hint">
          在固定目录 <code>themes/&lt;主题名&gt;/theme.css</code>{" "}
          放置主题后刷新列表即可切换。推荐覆盖 semantic token；深度定制可用{" "}
          <code>data-ui-region</code>。
        </p>
      </SettingsSection>
      <SettingsSection title="明暗" hint={selectedSchemeLabel}>
        <SettingsRow label="配色方案">
          <div className="ide-choice-group" role="group" aria-label="配色方案">
            {colorSchemeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={cx("ide-choice", colorScheme === option.value && "is-active")}
                onClick={() => setColorScheme(option.value)}
                aria-pressed={colorScheme === option.value}
              >
                {option.icon}
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="字体" hint={selectedFontFamilyLabel}>
        <SettingsRow label="界面字体">
          <div className="ide-choice-group" role="group" aria-label="界面字体">
            {fontFamilyOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={cx("ide-choice", uiFontFamily === option.value && "is-active")}
                onClick={() => setUiFontFamily(option.value)}
                aria-pressed={uiFontFamily === option.value}
              >
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="字号" hint={`${uiFontSize}px · 行高 ${uiLineHeight}`}>
        <SettingsRow label="基准字号（px）">
          <input
            className="ide-field"
            type="number"
            min={MIN_UI_FONT_SIZE}
            max={MAX_UI_FONT_SIZE}
            step={0.5}
            value={fontSizeDraft}
            aria-label="基准字号"
            onChange={(event) => setFontSizeDraft(event.target.value)}
            onBlur={commitFontSize}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </SettingsRow>
        <SettingsRow label="行高（倍）">
          <input
            className="ide-field"
            type="number"
            min={MIN_UI_LINE_HEIGHT}
            max={MAX_UI_LINE_HEIGHT}
            step={0.1}
            value={lineHeightDraft}
            aria-label="行高"
            onChange={(event) => setLineHeightDraft(event.target.value)}
            onBlur={commitLineHeight}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </SettingsRow>
        <p className="ide-hint">
          基准字号对应正文（默认 13px）；其余字号阶梯按同比例缩放。行高是相对字号的倍数。
        </p>
      </SettingsSection>
      <p className="ide-hint">
        当前：{selectedThemeLabel} · {selectedSchemeLabel} · {selectedFontFamilyLabel} ·{" "}
        {uiFontSize}px / {uiLineHeight}
      </p>
    </SettingsPanel>
  );
}
