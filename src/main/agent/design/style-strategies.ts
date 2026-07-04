import { VISUAL_TOKENS } from "@shared/visual-tokens";

export interface ColorPalette {
  primary: string;
  secondary: string;
  background: string;
  text: string;
  accent: string;
}

export interface ShadowToken {
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
  opacity: number;
}

export interface GradientToken {
  type: "linear" | "radial";
  angle?: number;
  stops: Array<{ color: string; pos: number }>;
}

export interface StyleStrategy {
  themeName: string;
  paletteName: string;
  fontFamily: string;
  colors: ColorPalette;
  spacing: {
    padding: number;
    gap: number;
  };
  radii: {
    sm: number;
    md: number;
    lg: number;
    pill: number;
  };
  elevation: {
    sm: ShadowToken;
    md: ShadowToken;
    lg: ShadowToken;
  };
  gradient?: GradientToken;
}

/**
 * 可选 PPT 设计风格策略及其稳定样式 Tokens 资产目录。
 *
 * 声明描述 tech-blue、business-clean 等策略的主题属性、配色板、字型与边距规范。
 */
const DEFAULT_RADII = VISUAL_TOKENS.radii;
const DEFAULT_ELEVATION = {
  sm: VISUAL_TOKENS.elevation.sm!,
  md: VISUAL_TOKENS.elevation.md!,
  lg: VISUAL_TOKENS.elevation.lg!,
};

export class StyleStrategies {
  private static readonly STRATEGIES = new Map<string, StyleStrategy>([
    [
      "tech-blue",
      {
        themeName: "tech",
        paletteName: "cyan",
        fontFamily: "JetBrains Mono, Outfit, sans-serif",
        colors: {
          primary: "#0284c7",
          secondary: "#0f172a",
          background: "#0f172a",
          text: "#f8fafc",
          accent: "#38bdf8",
        },
        spacing: { padding: 40, gap: 24 },
        radii: DEFAULT_RADII,
        elevation: DEFAULT_ELEVATION,
        gradient: {
          type: "linear",
          angle: 135,
          stops: [
            { color: "#0f172a", pos: 0 },
            { color: "#1e293b", pos: 100 },
          ],
        },
      },
    ],
    [
      "business-clean",
      {
        themeName: "nordic",
        paletteName: "warm-gray",
        fontFamily: "Georgia, serif",
        colors: {
          primary: "#1e293b",
          secondary: "#64748b",
          background: "#f8fafc",
          text: "#0f172a",
          accent: "#b45309",
        },
        spacing: { padding: 50, gap: 32 },
        radii: DEFAULT_RADII,
        elevation: DEFAULT_ELEVATION,
        gradient: {
          type: "linear",
          angle: 135,
          stops: [
            { color: "#fbfbfa", pos: 0 },
            { color: "#f0f0ef", pos: 100 },
          ],
        },
      },
    ],
  ]);

  /**
   * 获取指定的风格策略
   */
  static get(name: string): StyleStrategy | undefined {
    return StyleStrategies.STRATEGIES.get(name);
  }

  /**
   * 列出所有支持的风格主题配置
   */
  static list(): string[] {
    return Array.from(StyleStrategies.STRATEGIES.keys());
  }
}
