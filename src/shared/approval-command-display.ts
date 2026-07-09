import type { PresentationCommand } from "./commands";

export interface ApprovalCommandDisplay {
  label: string;
  detail?: string;
}

const THEME_LABELS: Record<string, string> = {
  nordic: "北欧极简",
  midnight: "黑客帝国",
  ocean: "商务蔚蓝",
  sunset: "落日余晖",
  purple: "流光极光",
};

const PALETTE_LABELS: Record<string, string> = {
  cyan: "湖蓝",
  green: "科技绿",
  purple: "薰衣紫",
  orange: "珊瑚橙",
};

const LAYOUT_LABELS: Record<string, string> = {
  cover: "封面布局",
  section: "过渡页布局",
  concept: "概念排版",
  comparison: "左右对比",
  process: "流程步骤",
  architecture: "分层架构",
  case: "案例展示",
  summary: "总结要点",
  toc: "目录布局",
  quote: "金句引用",
  "image-grid": "图片矩阵",
};

const BACKGROUND_LABELS: Record<string, string> = {
  default: "默认",
  hero: "品牌页",
  muted: "柔和强调",
};

const SLIDE_VARIANT_LABELS: Record<string, string> = {
  light: "浅色页",
  dark: "深色页",
  hero: "品牌页",
};

function named(value: string, labels: Record<string, string>): string {
  return labels[value] ?? value;
}

function compact(parts: Array<string | false | undefined>): string | undefined {
  const values = parts.filter(Boolean);
  return values.length > 0 ? values.join(" ") : undefined;
}

function pagePosition(index: number): string {
  return `位置: 第 ${index === 2147483647 ? "尾" : index} 页`;
}

export function formatApprovalCommand(command: PresentationCommand): ApprovalCommandDisplay {
  switch (command.type) {
    case "add-slide":
      return { label: "新增幻灯片", detail: pagePosition(command.index) };
    case "remove-slide":
      return { label: "移除幻灯片" };
    case "set-presentation-title":
      return { label: "修改项目名称", detail: `“${command.title}”` };
    case "set-slide-title":
      return { label: "更改单页标题", detail: `“${command.title}”` };
    case "add-element":
      return { label: "添加画布元素" };
    case "remove-element":
      return { label: "移除画布元素" };
    case "update-element":
      return { label: "更新图层属性" };
    case "set-theme":
      return {
        label: "应用设计主题",
        detail: compact([
          `主题: ${named(command.theme, THEME_LABELS)}`,
          command.palette
            ? `(色调: ${named(command.palette, PALETTE_LABELS)})`
            : undefined,
        ]),
      };
    case "set-slide-background":
      return {
        label: "更新页面背景",
        detail: `背景: ${named(command.backgroundVariant, BACKGROUND_LABELS)}`,
      };
    case "update-slide-variant":
      return {
        label: "更新页面视觉节奏",
        detail: `节奏: ${
          command.slideVariant
            ? named(command.slideVariant, SLIDE_VARIANT_LABELS)
            : "恢复默认"
        }`,
      };
    case "update-slide-layout":
      return {
        label: "更新页面布局",
        detail: `布局: ${named(command.layout, LAYOUT_LABELS)}`,
      };
    case "update-text-style":
      return {
        label: "调整文字样式",
        detail: compact([
          command.fontSize ? `字号: ${command.fontSize}px` : undefined,
          command.bold !== undefined ? `加粗: ${command.bold ? "是" : "否"}` : undefined,
          command.align
            ? `对齐: ${
              command.align === "left"
                ? "左"
                : command.align === "center"
                  ? "中"
                  : "右"
            }`
            : undefined,
        ]),
      };
    case "move-element":
      return {
        label: "移动图层位置",
        detail: `坐标: (${Math.round(command.x)}, ${Math.round(command.y)})`,
      };
    case "resize-element":
      return {
        label: "调整图层大小",
        detail: `尺寸: ${Math.round(command.width)}x${Math.round(command.height)}`,
      };
    case "restore-slide-elements":
      return {
        label: "还原图层状态",
        detail: `元素数: ${command.elements.length}`,
      };
    case "restore-slide":
      return { label: "还原页面状态", detail: command.slide.title };
  }
}
