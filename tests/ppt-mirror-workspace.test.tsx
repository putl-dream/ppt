// @vitest-environment jsdom

import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN_SYSTEM } from "../src/design-system";
import type { DisplayEvent } from "../src/shared/card-display-protocol";
import type { Presentation } from "../src/shared/presentation";
import { PPTMirror } from "../src/renderer/src/components/PPTMirror";
import { ArtifactCardHost } from "../src/renderer/src/cards/hosts/ArtifactCardHost";
import {
  clearAllDisplayCardManagers,
  ingestDisplayEvent,
} from "../src/renderer/src/cards/display-card-managers";

type SlidePreviewEvent = Extract<DisplayEvent, { kind: "artifact.slide-preview" }>;

const presentation: Presentation = {
  id: "deck-1",
  title: "右侧预览升级",
  revision: 2,
  designSystem: DEFAULT_DESIGN_SYSTEM,
  slides: [
    { id: "slide-1", title: "封面", layout: "cover", elements: [] },
    { id: "slide-2", title: "核心结论", layout: "content", elements: [] },
  ],
};

function preview(index: number): SlidePreviewEvent {
  return {
    protocolVersion: 1,
    eventId: `preview-${index}`,
    emittedAt: "2026-07-26T00:00:00.000Z",
    kind: "artifact.slide-preview",
    category: "artifact",
    source: { kind: "tool", toolName: "PreviewSvgPage", toolCallId: `call-${index}` },
    scope: { sessionId: "session-1", runId: "run-1" },
    semantics: { blocking: false, requiresResponse: false, priority: "normal" },
    payload: {
      slideId: `slide-${index}`,
      title: index === 1 ? "封面" : "核心结论",
      description: `第 ${index} 页检查说明`,
      thumbnail: {
        pngBase64: "aGVsbG8=",
        width: 640,
        height: 360,
        mimeType: "image/png",
      },
    },
  };
}

function MirrorHarness() {
  const [selectedSlideId, setSelectedSlideId] = useState("slide-1");
  return (
    <PPTMirror
      presentation={presentation}
      selectedSlideId={selectedSlideId}
      onSelectSlide={setSelectedSlideId}
      themeMode="light"
      logoUrl={null}
      onCloseMirror={() => undefined}
      highlightSlideId={null}
    />
  );
}

describe("PPTMirror preview workspace", () => {
  beforeEach(() => {
    clearAllDisplayCardManagers();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    ingestDisplayEvent(preview(1));
    ingestDisplayEvent(preview(2));
  });

  afterEach(() => {
    cleanup();
    clearAllDisplayCardManagers();
  });

  it("hosts the latest inspection batch in the right preview and syncs page selection", () => {
    render(<MirrorHarness />);

    expect(screen.getByText("右侧预览升级")).not.toBeNull();
    expect(screen.getByRole("tab", { name: /检查结果\s*2/ }).getAttribute("aria-selected"))
      .toBe("true");
    expect(screen.getAllByText("已检查 2 页").length).toBeGreaterThan(0);
    expect(screen.getByText("点击查看大图")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "查看 核心结论 大图" }));
    expect(screen.getByRole("dialog", { name: "核心结论 页面预览" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));

    fireEvent.click(screen.getByRole("tab", { name: /幻灯片\s*2/ }));
    expect(screen.getByRole("button", { name: "放大查看第 2 页：核心结论" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "选择第 2 页：核心结论" })
      .getAttribute("aria-current")).toBe("page");
  });

  it("does not render inspection previews in the chat artifact host", () => {
    render(
      <ArtifactCardHost
        presentation={presentation}
        busy={false}
        onConfirmBrief={() => undefined}
        onConfirmOutline={() => undefined}
        onReviseOutline={() => undefined}
        onOpenDeckPreview={() => undefined}
        onExportDeck={() => undefined}
      />,
    );

    expect(screen.queryByText("页面预览")).toBeNull();
    expect(screen.queryByText("已检查 2 页")).toBeNull();
  });
});
