import { searchVisualStyles } from "./catalog";
import {
  designSystemV2Schema,
  type ArgumentMode,
  type ColorOverrides,
  type ColorScheme,
  type DesignSystemV2,
  type NamedColorScheme,
  type ReadingMode,
  type VisualStyle,
} from "./schema";

export interface DesignPreset {
  id: VisualStyle;
  label: string;
  description: string;
  system: DesignSystemV2;
}

function preset(
  visualStyle: VisualStyle,
  label: string,
  description: string,
  argumentMode: ArgumentMode,
  colorScheme: NamedColorScheme,
  readingMode: ReadingMode,
): DesignPreset {
  return {
    id: visualStyle,
    label,
    description,
    system: designSystemV2Schema.parse({
      version: 2,
      argumentMode,
      visualStyle,
      colorScheme,
      readingMode,
    }),
  };
}

/** One first-class preset for every ppt-master visual style. */
export const DESIGN_PRESETS: readonly DesignPreset[] = Object.freeze([
  preset("swiss-minimal", "瑞士极简", "网格严谨、强留白的高端咨询表达", "pyramid", "business-blue", "balanced"),
  preset("soft-rounded", "柔和圆角", "友好圆角容器与克制柔影", "instructional", "business-blue", "balanced"),
  preset("glassmorphism", "玻璃拟态", "暗场玻璃、流光与漂浮层级", "showcase", "tech-dark", "presentation"),
  preset("dark-tech", "深色科技", "暗色画布与精确发光几何", "pyramid", "tech-dark", "balanced"),
  preset("blueprint", "蓝图", "工程线稿、网格与技术注释", "instructional", "tech-dark", "balanced"),
  preset("editorial", "编辑出版", "杂志栏目、细规则线与字体角色对照", "pyramid", "warm-paper", "balanced"),
  preset("photo-editorial", "摄影编辑", "由全出血摄影主导的杂志构图", "narrative", "mono-report", "presentation"),
  preset("data-journalism", "数据新闻", "出版级数据密度、微图表与来源线", "pyramid", "mono-report", "text"),
  preset("brutalist", "粗野主义", "报纸高密度、硬框与外露网格", "briefing", "mono-report", "text"),
  preset("memphis", "孟菲斯", "撞色几何与年轻能量", "showcase", "business-blue", "presentation"),
  preset("zine", "小刊", "Riso 错版、halftone 与 DIY 拼贴", "narrative", "warm-paper", "balanced"),
  preset("vintage-poster", "复古海报", "中世纪平面色块与印刷暖意", "narrative", "warm-paper", "presentation"),
  preset("paper-cut", "剪纸", "不规则纸边、真实层叠与触感", "instructional", "soft-academic", "balanced"),
  preset("sketch-notes", "手绘笔记", "暖纸、doodle 与柔和知识表达", "instructional", "warm-paper", "balanced"),
  preset("ink-notes", "墨迹笔记", "专业手墨线与巨大留白", "instructional", "mono-report", "balanced"),
  preset("chalkboard", "黑板", "粉笔线、深板面与课堂氛围", "instructional", "tech-dark", "balanced"),
  preset("ink-wash", "水墨", "宣纸留白、克制笔触与印章", "narrative", "warm-paper", "presentation"),
  preset("pixel-art", "像素风", "严格像素网格与复古游戏语法", "showcase", "tech-dark", "presentation"),
]);

export function getDesignPreset(id: VisualStyle): DesignPreset | undefined {
  return DESIGN_PRESETS.find((item) => item.id === id);
}

export interface DesignPresetQuery {
  visualStyle?: VisualStyle;
  argumentMode?: ArgumentMode;
  colorScheme?: NamedColorScheme;
  readingMode?: ReadingMode;
  text?: string;
}

export function queryDesignPresets(query: DesignPresetQuery = {}): readonly DesignPreset[] {
  const textMatches = query.text
    ? new Set(searchVisualStyles(query.text).map((style) => style.id))
    : undefined;
  return DESIGN_PRESETS.filter((presetItem) => (
    (!query.visualStyle || presetItem.system.visualStyle === query.visualStyle)
    && (!query.argumentMode || presetItem.system.argumentMode === query.argumentMode)
    && (!query.colorScheme || presetItem.system.colorScheme === query.colorScheme)
    && (!query.readingMode || presetItem.system.readingMode === query.readingMode)
    && (!textMatches || textMatches.has(presetItem.system.visualStyle))
  ));
}

export interface SelectDesignPresetInput {
  visualStyle?: VisualStyle;
  query?: string;
  argumentMode?: ArgumentMode;
  colorScheme?: ColorScheme;
  readingMode?: ReadingMode;
  colors?: ColorOverrides;
}

/**
 * Selects a catalog starting point and returns a fresh schema-validated v2
 * source. Explicit axes always win over preset defaults.
 */
export function selectDesignPreset(input: SelectDesignPresetInput = {}): DesignSystemV2 {
  const searchedStyle = input.query
    ? searchVisualStyles(input.query)[0]?.id
    : undefined;
  const visualStyle = input.visualStyle ?? searchedStyle ?? "swiss-minimal";
  const selected = getDesignPreset(visualStyle) ?? DESIGN_PRESETS[0];
  return designSystemV2Schema.parse({
    ...selected.system,
    argumentMode: input.argumentMode ?? selected.system.argumentMode,
    visualStyle,
    colorScheme: input.colorScheme ?? selected.system.colorScheme,
    readingMode: input.readingMode ?? selected.system.readingMode,
    ...(input.colors ? { colors: input.colors } : {}),
  });
}
