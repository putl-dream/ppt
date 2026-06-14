export interface ColorPalette {
  primary: string;
  secondary: string;
  background: string;
  text: string;
  accent: string;
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
}

/**
 * 可选 PPT 设计风格策略及其稳定样式 Tokens 资产目录。
 *
 * 声明描述 tech-blue、business-clean 等策略的主题属性、配色板、字型与边距规范。
 */
export class StyleStrategies {
  private static readonly STRATEGIES = new Map<string, StyleStrategy>([
    [
      "tech-blue",
      {
        themeName: "tech",
        paletteName: "cyan",
        fontFamily: "JetBrains Mono, Outfit, sans-serif",
        colors: {
          primary: "#0284c7", // sky-600
          secondary: "#0f172a", // slate-900
          background: "#0f172a",
          text: "#f8fafc",
          accent: "#38bdf8",
        },
        spacing: { padding: 40, gap: 24 },
      },
    ],
    [
      "business-clean",
      {
        themeName: "nordic",
        paletteName: "warm-gray",
        fontFamily: "Georgia, serif",
        colors: {
          primary: "#1e293b", // slate-800
          secondary: "#64748b", // slate-500
          background: "#f8fafc", // slate-50
          text: "#0f172a", // slate-900
          accent: "#b45309", // amber-700
        },
        spacing: { padding: 50, gap: 32 },
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
