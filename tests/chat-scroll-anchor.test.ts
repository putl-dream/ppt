// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_FOLD_ANCHORED_EVENT,
  beginFoldScroll,
  commitFoldScroll,
  isChatFollowSuppressed,
  isChatNearBottom,
  suppressChatFollow,
} from "../src/renderer/src/components/chat-scroll-anchor";

function mountFoldFixture(options?: { scrollTop?: number; scrollHeight?: number }) {
  const viewport = document.createElement("div");
  viewport.className = "chat-scroll-viewport";
  Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 400 });
  Object.defineProperty(viewport, "scrollHeight", {
    configurable: true,
    value: options?.scrollHeight ?? 1200,
  });
  viewport.scrollTop = options?.scrollTop ?? 0;

  const header = document.createElement("button");
  header.getBoundingClientRect = () =>
    ({
      top: 200,
      bottom: 220,
      left: 0,
      right: 100,
      width: 100,
      height: 20,
      x: 0,
      y: 200,
      toJSON: () => ({}),
    }) as DOMRect;

  viewport.appendChild(header);
  document.body.appendChild(viewport);
  return { viewport, header };
}

describe("chat-scroll-anchor", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it("detects near-bottom within the follow threshold", () => {
    const { viewport } = mountFoldFixture({ scrollTop: 744, scrollHeight: 1200 });
    expect(isChatNearBottom(viewport)).toBe(true);
    viewport.scrollTop = 700;
    expect(isChatNearBottom(viewport)).toBe(false);
  });

  it("suppresses follow for a short window", () => {
    vi.useFakeTimers();
    const { viewport } = mountFoldFixture();
    suppressChatFollow(viewport, 100);
    expect(isChatFollowSuppressed(viewport)).toBe(true);
    vi.advanceTimersByTime(101);
    expect(isChatFollowSuppressed(viewport)).toBe(false);
  });

  it("anchors scroll so the header keeps its viewport position", () => {
    const { viewport, header } = mountFoldFixture({ scrollTop: 300 });
    const snapshot = beginFoldScroll(header, "anchor");
    expect(snapshot).not.toBeNull();
    expect(isChatFollowSuppressed(viewport)).toBe(true);

    header.getBoundingClientRect = () =>
      ({
        top: 120,
        bottom: 140,
        left: 0,
        right: 100,
        width: 100,
        height: 20,
        x: 0,
        y: 120,
        toJSON: () => ({}),
      }) as DOMRect;

    const anchored = vi.fn();
    viewport.addEventListener(CHAT_FOLD_ANCHORED_EVENT, anchored);
    commitFoldScroll(header, snapshot);
    expect(viewport.scrollTop).toBe(220);
    expect(anchored).toHaveBeenCalledTimes(1);
  });

  it("sticks to bottom without emitting the anchored event", () => {
    const { viewport, header } = mountFoldFixture({ scrollTop: 100, scrollHeight: 900 });
    const snapshot = beginFoldScroll(header, "stick");
    const anchored = vi.fn();
    viewport.addEventListener(CHAT_FOLD_ANCHORED_EVENT, anchored);
    commitFoldScroll(header, snapshot);
    expect(viewport.scrollTop).toBe(900);
    expect(anchored).not.toHaveBeenCalled();
  });
});
