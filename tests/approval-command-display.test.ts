import { describe, expect, it } from "vitest";
import { formatApprovalCommand } from "../src/shared/approval-command-display";
import type { PresentationCommand } from "../src/shared/commands";
import { TEST_DESIGN_SYSTEM } from "./design-engine-test-utils";

const textElement = {
  id: "element-1",
  type: "text",
  x: 120,
  y: 120,
  width: 400,
  height: 80,
  text: "内容",
  fontSize: 24,
} as const;

const slide = {
  id: "slide-1",
  title: "标题页",
  elements: [textElement],
};

describe("approval command display", () => {
  it("provides a non-empty label for every approval command type", () => {
    const commands: PresentationCommand[] = [
      { id: "cmd-1", type: "add-slide", slide, index: 0 },
      { id: "cmd-2", type: "remove-slide", slideId: "slide-1" },
      { id: "cmd-3", type: "set-presentation-title", title: "新标题" },
      { id: "cmd-4", type: "set-slide-title", slideId: "slide-1", title: "单页标题" },
      { id: "cmd-5", type: "add-element", slideId: "slide-1", element: textElement },
      { id: "cmd-6", type: "remove-element", slideId: "slide-1", elementId: "element-1" },
      { id: "cmd-7", type: "update-element", slideId: "slide-1", elementId: "element-1", element: textElement },
      { id: "cmd-8", type: "set-design-system", designSystem: TEST_DESIGN_SYSTEM },
      { id: "cmd-9", type: "set-slide-design", slideId: "slide-1", designOverride: { backgroundStyle: "gradient" } },
      { id: "cmd-10", type: "update-slide-variant", slideId: "slide-1", slideVariant: "hero" },
      { id: "cmd-11", type: "update-slide-layout", slideId: "slide-1", layout: "toc" },
      { id: "cmd-12", type: "update-text-style", slideId: "slide-1", elementId: "element-1", fontSize: 28, bold: true },
      { id: "cmd-13", type: "move-element", slideId: "slide-1", elementId: "element-1", x: 180, y: 200 },
      { id: "cmd-14", type: "resize-element", slideId: "slide-1", elementId: "element-1", width: 480, height: 120 },
      { id: "cmd-15", type: "restore-slide-elements", slideId: "slide-1", elements: [textElement] },
      { id: "cmd-16", type: "restore-slide", slide },
    ];

    for (const command of commands) {
      expect(formatApprovalCommand(command).label.trim()).not.toBe("");
    }
  });

  it("formats slide variant, design override, and newer layout details", () => {
    expect(formatApprovalCommand({
      id: "variant",
      type: "update-slide-variant",
      slideId: "slide-1",
      slideVariant: "hero",
    })).toEqual({
      label: "更新页面视觉节奏",
      detail: "节奏: 品牌页",
    });

    expect(formatApprovalCommand({
      id: "variant-default",
      type: "update-slide-variant",
      slideId: "slide-1",
    })).toEqual({
      label: "更新页面视觉节奏",
      detail: "节奏: 恢复默认",
    });

    expect(formatApprovalCommand({
      id: "bg",
      type: "set-slide-design",
      slideId: "slide-1",
      designOverride: { backgroundStyle: "gradient" },
    }).detail).toBe("backgroundStyle");

    expect(formatApprovalCommand({
      id: "layout",
      type: "update-slide-layout",
      slideId: "slide-1",
      layout: "toc",
    }).detail).toBe("布局: 目录布局");
  });
});
