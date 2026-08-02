export const CHAT_FOLLOW_THRESHOLD_PX = 56;

export interface FoldToken {
  wasFollowing: boolean;
  headerTop: number;
  anchor: HTMLElement | null;
}

export interface ChatScrollControllerOptions {
  followThresholdPx?: number;
  /** Injected for tests; defaults to requestAnimationFrame. */
  scheduleFrame?: (cb: () => void) => number;
  cancelFrame?: (id: number) => void;
}

export interface ChatScrollController {
  setViewport(element: HTMLElement | null): void;
  setStream(element: HTMLElement | null): void;
  isFollowing(): boolean;
  setFollowing(value: boolean): void;
  isLayoutLocked(): boolean;
  scrollToBottom(): void;
  stickToBottomIfFollowing(): void;
  beginFold(anchor: HTMLElement | null): FoldToken | null;
  commitFold(token: FoldToken | null): void;
  getScrollTop(): number;
  setScrollTop(value: number): void;
  /** Bind scroll + ResizeObserver. Safe to call repeatedly; returns disposer. */
  attach(): () => void;
  dispose(): void;
}

function distanceFromBottom(viewport: HTMLElement): number {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
}

/**
 * Single owner of chat stick-to-bottom and fold scroll compensation.
 * Fold components only call beginFold/commitFold; they never write scrollTop.
 */
export function createChatScrollController(
  options: ChatScrollControllerOptions = {},
): ChatScrollController {
  const followThresholdPx = options.followThresholdPx ?? CHAT_FOLLOW_THRESHOLD_PX;
  const scheduleFrame = options.scheduleFrame
    ?? ((cb) => window.requestAnimationFrame(cb));
  const cancelFrame = options.cancelFrame
    ?? ((id) => window.cancelAnimationFrame(id));

  let viewport: HTMLElement | null = null;
  let stream: HTMLElement | null = null;
  let following = true;
  let layoutLocked = false;
  let followFrame: number | null = null;
  let unlockFrame: number | null = null;
  let detach: (() => void) | null = null;
  let ignoreScroll = false;

  const setFollowing = (value: boolean) => {
    following = value;
  };

  const scrollToBottom = () => {
    if (!viewport) return;
    ignoreScroll = true;
    viewport.scrollTop = viewport.scrollHeight;
    ignoreScroll = false;
  };

  const stickToBottomIfFollowing = () => {
    if (!following || layoutLocked || !viewport) return;
    if (followFrame !== null) return;
    followFrame = scheduleFrame(() => {
      followFrame = null;
      if (!following || layoutLocked || !viewport) return;
      scrollToBottom();
    });
  };

  const lockLayout = () => {
    layoutLocked = true;
    if (unlockFrame !== null) {
      cancelFrame(unlockFrame);
      unlockFrame = null;
    }
    // Hold through the current frame and the next so ResizeObserver settles.
    unlockFrame = scheduleFrame(() => {
      unlockFrame = scheduleFrame(() => {
        unlockFrame = null;
        layoutLocked = false;
      });
    });
  };

  const updateFollowingFromScroll = () => {
    if (!viewport || layoutLocked || ignoreScroll) return;
    following = distanceFromBottom(viewport) <= followThresholdPx;
  };

  const beginFold = (anchor: HTMLElement | null): FoldToken | null => {
    if (!viewport) return null;
    lockLayout();
    return {
      wasFollowing: following,
      headerTop: anchor?.getBoundingClientRect().top ?? 0,
      anchor,
    };
  };

  const commitFold = (token: FoldToken | null) => {
    if (!token || !viewport) return;
    lockLayout();
    if (token.wasFollowing) {
      scrollToBottom();
      following = true;
      return;
    }
    const anchor = token.anchor;
    if (anchor) {
      const delta = anchor.getBoundingClientRect().top - token.headerTop;
      if (delta !== 0) {
        ignoreScroll = true;
        viewport.scrollTop += delta;
        ignoreScroll = false;
      }
    }
    following = false;
  };

  const attach = (): (() => void) => {
    detach?.();
    detach = null;
    if (!viewport) return () => {};

    const onScroll = () => updateFollowingFromScroll();
    viewport.addEventListener("scroll", onScroll, { passive: true });

    let observer: ResizeObserver | null = null;
    if (stream && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        stickToBottomIfFollowing();
      });
      observer.observe(stream);
    }

    const cleanup = () => {
      viewport?.removeEventListener("scroll", onScroll);
      observer?.disconnect();
      if (followFrame !== null) {
        cancelFrame(followFrame);
        followFrame = null;
      }
      if (unlockFrame !== null) {
        cancelFrame(unlockFrame);
        unlockFrame = null;
      }
      layoutLocked = false;
    };
    detach = cleanup;
    return cleanup;
  };

  const dispose = () => {
    detach?.();
    detach = null;
    viewport = null;
    stream = null;
  };

  return {
    setViewport(element) {
      viewport = element;
    },
    setStream(element) {
      stream = element;
    },
    isFollowing: () => following,
    setFollowing,
    isLayoutLocked: () => layoutLocked,
    scrollToBottom,
    stickToBottomIfFollowing,
    beginFold,
    commitFold,
    getScrollTop: () => viewport?.scrollTop ?? 0,
    setScrollTop(value) {
      if (!viewport) return;
      ignoreScroll = true;
      viewport.scrollTop = value;
      ignoreScroll = false;
    },
    attach,
    dispose,
  };
}
