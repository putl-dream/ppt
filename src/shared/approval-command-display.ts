import type { PresentationCommand } from "./commands";

export interface ApprovalCommandDisplay {
  label: string;
  detail?: string;
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
    case "set-design-system":
      return {
        label: "应用设计系统",
        detail: compact([
          `视觉风格: ${command.designSystem.visualStyle}`,
          `论证模式: ${command.designSystem.argumentMode}`,
          `阅读模式: ${command.designSystem.readingMode}`,
        ]),
      };
    case "restore-slide":
      return { label: "还原页面状态", detail: command.slide.title };
    default: {
      const legacy = command as { type: string };
      return { label: "Legacy command", detail: legacy.type };
    }
  }
}
