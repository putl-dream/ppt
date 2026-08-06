import { getTypewriterStepSize, splitGraphemes } from "@shared/streaming-text";
import type React from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MessageMarkdown } from "./MessageMarkdown";

interface TypewriterMarkdownProps {
  content: string;
  active: boolean;
  className?: string;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return reduced;
}

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );

  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  return visible;
}

export const TypewriterMarkdown: React.FC<TypewriterMarkdownProps> = ({
  content,
  active,
  className,
}) => {
  const graphemes = useMemo(() => splitGraphemes(content), [content]);
  const graphemesRef = useRef(graphemes);
  const previousGraphemesRef = useRef(graphemes);
  const activeRef = useRef(active);
  graphemesRef.current = graphemes;
  activeRef.current = active;
  const reducedMotion = useReducedMotion();
  const pageVisible = usePageVisible();
  const [revealedCount, setRevealedCount] = useState(() => (active ? 0 : graphemes.length));

  useLayoutEffect(() => {
    const previous = previousGraphemesRef.current;
    previousGraphemesRef.current = graphemes;
    setRevealedCount((current) => {
      if (reducedMotion) return graphemes.length;
      let commonPrefixLength = 0;
      const comparableLength = Math.min(previous.length, graphemes.length);
      while (
        commonPrefixLength < comparableLength &&
        previous[commonPrefixLength] === graphemes[commonPrefixLength]
      ) {
        commonPrefixLength += 1;
      }
      return Math.min(current, commonPrefixLength);
    });
  }, [graphemes, reducedMotion]);

  const pendingCount = graphemes.length - revealedCount;
  const animating = pendingCount > 0 && !reducedMotion;
  const shouldTick = pageVisible && !reducedMotion && (active || animating);
  const showCaret = !reducedMotion && (active || animating);
  const hasStreamedRef = useRef(active);
  if (active) hasStreamedRef.current = true;
  const completedAnnouncement = hasStreamedRef.current && !active && !animating ? "回复已完成" : "";

  useEffect(() => {
    if (!shouldTick) return;
    const timer = window.setInterval(() => {
      setRevealedCount((current) => {
        const latestGraphemes = graphemesRef.current;
        const pending = latestGraphemes.length - current;
        if (pending <= 0) return current;
        return Math.min(
          latestGraphemes.length,
          current + getTypewriterStepSize(pending, activeRef.current),
        );
      });
    }, 24);
    return () => window.clearInterval(timer);
  }, [shouldTick]);

  const visibleContent = useMemo(
    () => graphemes.slice(0, revealedCount).join(""),
    [graphemes, revealedCount],
  );

  return (
    <>
      <MessageMarkdown
        content={visibleContent}
        className={[
          className,
          "typewriter-markdown",
          showCaret ? "typewriter-markdown--active" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        renderEmpty
        ariaBusy={active || animating}
      />
      {hasStreamedRef.current && (
        <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
          {completedAnnouncement}
        </span>
      )}
    </>
  );
};
