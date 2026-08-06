import React, {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import {
  type ChatScrollController,
  createChatScrollController,
  type FoldToken,
} from "./chat-scroll-controller";

export type { FoldToken };

export interface ChatScrollApi {
  viewportRef: RefObject<HTMLDivElement | null>;
  streamRef: RefObject<HTMLDivElement | null>;
  /** Sync refs into the controller and attach listeners. Returns disposer. */
  bind: () => () => void;
  isFollowing: () => boolean;
  setFollowing: (value: boolean) => void;
  scrollToBottom: () => void;
  stickToBottomIfFollowing: () => void;
  beginFold: (anchor: HTMLElement | null) => FoldToken | null;
  commitFold: (token: FoldToken | null) => void;
  getScrollTop: () => number;
  setScrollTop: (value: number) => void;
}

const noopRef: RefObject<HTMLDivElement | null> = { current: null };

const noopApi: ChatScrollApi = {
  viewportRef: noopRef,
  streamRef: noopRef,
  bind: () => () => {},
  isFollowing: () => false,
  setFollowing: () => {},
  scrollToBottom: () => {},
  stickToBottomIfFollowing: () => {},
  beginFold: () => null,
  commitFold: () => {},
  getScrollTop: () => 0,
  setScrollTop: () => {},
};

const ChatScrollContext = createContext<ChatScrollApi | null>(null);

export function ChatScrollProvider({ children }: { children: ReactNode }) {
  const controllerRef = useRef<ChatScrollController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createChatScrollController();
  }
  const controller = controllerRef.current;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => controller.dispose(), [controller]);

  const bind = useCallback(() => {
    controller.setViewport(viewportRef.current);
    controller.setStream(streamRef.current);
    return controller.attach();
  }, [controller]);

  const api = useMemo<ChatScrollApi>(
    () => ({
      viewportRef,
      streamRef,
      bind,
      isFollowing: () => controller.isFollowing(),
      setFollowing: (value) => controller.setFollowing(value),
      scrollToBottom: () => controller.scrollToBottom(),
      stickToBottomIfFollowing: () => controller.stickToBottomIfFollowing(),
      beginFold: (anchor) => controller.beginFold(anchor),
      commitFold: (token) => controller.commitFold(token),
      getScrollTop: () => controller.getScrollTop(),
      setScrollTop: (value) => controller.setScrollTop(value),
    }),
    [bind, controller],
  );

  return <ChatScrollContext.Provider value={api}>{children}</ChatScrollContext.Provider>;
}

/** Returns a no-op API when rendered outside ChatScrollProvider (unit tests). */
export function useChatScroll(): ChatScrollApi {
  return useContext(ChatScrollContext) ?? noopApi;
}
