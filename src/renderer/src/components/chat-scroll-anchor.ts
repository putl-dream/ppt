/** Viewport selector shared with ChatWorkspace scroll follow. */
export const CHAT_SCROLL_VIEWPORT_SELECTOR = ".chat-scroll-viewport";

/** Fired after an anchored fold so ChatWorkspace can drop follow mode. */
export const CHAT_FOLD_ANCHORED_EVENT = "chat-fold-anchored";

const SUPPRESS_ATTR = "data-chat-follow-suppress-until";
const FOLLOW_THRESHOLD_PX = 56;
const DEFAULT_SUPPRESS_MS = 160;

export function findChatScrollViewport(from: Element | null | undefined): HTMLElement | null {
  if (!from) return null;
  return from.closest(CHAT_SCROLL_VIEWPORT_SELECTOR);
}

export function isChatNearBottom(
  viewport: HTMLElement,
  thresholdPx = FOLLOW_THRESHOLD_PX,
): boolean {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= thresholdPx;
}

export function suppressChatFollow(
  viewport: HTMLElement,
  durationMs = DEFAULT_SUPPRESS_MS,
): void {
  const until = Date.now() + durationMs;
  const existing = Number(viewport.getAttribute(SUPPRESS_ATTR) ?? 0);
  viewport.setAttribute(SUPPRESS_ATTR, String(Math.max(existing, until)));
}

export function isChatFollowSuppressed(viewport: HTMLElement): boolean {
  const until = Number(viewport.getAttribute(SUPPRESS_ATTR) ?? 0);
  if (until <= Date.now()) {
    if (until > 0) viewport.removeAttribute(SUPPRESS_ATTR);
    return false;
  }
  return true;
}

export type FoldScrollMode = "anchor" | "stick";

export interface FoldScrollSnapshot {
  headerTop: number;
  mode: FoldScrollMode;
}

/**
 * Capture header position and briefly pause follow-scroll before a fold
 * mount/unmount that will change stream height.
 */
export function beginFoldScroll(
  header: HTMLElement | null | undefined,
  mode: FoldScrollMode,
): FoldScrollSnapshot | null {
  if (!header) return null;
  const viewport = findChatScrollViewport(header);
  if (!viewport) return null;
  suppressChatFollow(viewport);
  return { headerTop: header.getBoundingClientRect().top, mode };
}

/**
 * After layout, either keep the header visually fixed or snap to bottom.
 * Call from useLayoutEffect keyed on the fold open state.
 */
export function commitFoldScroll(
  header: HTMLElement | null | undefined,
  snapshot: FoldScrollSnapshot | null,
): void {
  if (!header || !snapshot) return;
  const viewport = findChatScrollViewport(header);
  if (!viewport) return;

  suppressChatFollow(viewport);
  if (snapshot.mode === "stick") {
    viewport.scrollTop = viewport.scrollHeight;
    return;
  }

  const delta = header.getBoundingClientRect().top - snapshot.headerTop;
  if (delta !== 0) {
    viewport.scrollTop += delta;
  }
  // Drop follow so ResizeObserver does not undo the anchored header position
  // when the fold leaves the viewport still within the near-bottom threshold.
  viewport.dispatchEvent(new CustomEvent(CHAT_FOLD_ANCHORED_EVENT, { bubbles: false }));
}
