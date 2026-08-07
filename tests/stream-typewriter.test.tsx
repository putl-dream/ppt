// @vitest-environment jsdom

import { splitGraphemes } from "@shared/streaming-text";
import { cleanup, render } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TypewriterMarkdown } from "../src/renderer/src/components/TypewriterMarkdown";

function mockReducedMotion(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
}

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("stream typewriter component", () => {
  const visibleText = (container: HTMLElement) =>
    container.querySelector(".typewriter-markdown")?.textContent ?? "";

  beforeEach(() => {
    vi.useFakeTimers();
    mockReducedMotion(false);
    setVisibility("visible");
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("reveals complete Unicode graphemes one display tick at a time", () => {
    expect(splitGraphemes("中A👩‍💻e\u0301")).toEqual(["中", "A", "👩‍💻", "e\u0301"]);
    const view = render(<TypewriterMarkdown content="中A👩‍💻e\u0301" active />);

    expect(visibleText(view.container)).toBe("");
    act(() => vi.advanceTimersByTime(24));
    expect(visibleText(view.container)).toBe("中");
    act(() => vi.advanceTimersByTime(48));
    expect(visibleText(view.container)).toBe("中A👩‍💻");
  });

  it("keeps its display clock alive while network chunks arrive faster than a tick", () => {
    const view = render(<TypewriterMarkdown content="" active />);
    for (const content of ["A", "AB", "ABC", "ABCD", "ABCDE"]) {
      view.rerender(<TypewriterMarkdown content={content} active />);
      act(() => vi.advanceTimersByTime(20));
      if (content === "AB") {
        expect(visibleText(view.container)).not.toBe("");
      }
    }

    expect(visibleText(view.container).length).toBeGreaterThan(0);
  });

  it("drains the received buffer after transport completion without dropping text", () => {
    const content = "逐字展示".repeat(40);
    const view = render(<TypewriterMarkdown content={content} active />);
    act(() => vi.advanceTimersByTime(48));
    expect(visibleText(view.container)).not.toBe(content);

    view.rerender(<TypewriterMarkdown content={content} active={false} />);
    act(() => vi.advanceTimersByTime(2_000));
    expect(visibleText(view.container)).toBe(content);
    expect(view.getByRole("status").textContent).toBe("回复已完成");
  });

  it("honors reduced motion, page visibility, and interval cleanup", () => {
    mockReducedMotion(true);
    const reduced = render(<TypewriterMarkdown content="立即展示" active />);
    expect(visibleText(reduced.container)).toBe("立即展示");
    reduced.unmount();

    mockReducedMotion(false);
    act(() => setVisibility("hidden"));
    const paused = render(<TypewriterMarkdown content="后台暂停" active />);
    act(() => vi.advanceTimersByTime(240));
    expect(visibleText(paused.container)).toBe("");

    act(() => setVisibility("visible"));
    act(() => vi.advanceTimersByTime(24));
    expect(visibleText(paused.container)).toBe("后");
    paused.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
