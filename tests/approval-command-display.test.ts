import { describe, expect, it } from "vitest";
import { formatApprovalCommand } from "../src/shared/approval-command-display";
import type { PresentationCommand } from "../src/shared/commands";
import { createSvgTestSlide } from "../src/shared/presentation";
import { TEST_DESIGN_SYSTEM } from "./design-engine-test-utils";

const slide = createSvgTestSlide({ id: "slide-1", title: "标题页" });

describe("approval command display", () => {
  it("provides a non-empty label for every approval command type", () => {
    const commands: PresentationCommand[] = [
      { id: "cmd-1", type: "add-slide", slide, index: 0 },
      { id: "cmd-2", type: "remove-slide", slideId: "slide-1" },
      { id: "cmd-3", type: "set-presentation-title", title: "新标题" },
      { id: "cmd-4", type: "set-slide-title", slideId: "slide-1", title: "单页标题" },
      { id: "cmd-5", type: "set-design-system", designSystem: TEST_DESIGN_SYSTEM },
      { id: "cmd-6", type: "restore-slide", slide },
    ];

    for (const command of commands) {
      expect(formatApprovalCommand(command).label.trim()).not.toBe("");
    }
  });

  it("formats design system details", () => {
    expect(formatApprovalCommand({
      id: "design",
      type: "set-design-system",
      designSystem: TEST_DESIGN_SYSTEM,
    }).detail).toBe(
      `视觉风格: ${TEST_DESIGN_SYSTEM.visualStyle} `
      + `论证模式: ${TEST_DESIGN_SYSTEM.argumentMode} `
      + `阅读模式: ${TEST_DESIGN_SYSTEM.readingMode}`,
    );
  });
});
