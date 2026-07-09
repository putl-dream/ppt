import { useEffect, useRef } from "react";

interface UseInboxPollerOptions {
  activeSessionId: string;
  sessionLoaded: boolean;
  busy: boolean;
  onInboxTurn: (prompt: string) => Promise<void> | void;
  onError?: (error: unknown) => void;
}

export function useInboxPoller({
  activeSessionId,
  sessionLoaded,
  busy,
  onInboxTurn,
  onError,
}: UseInboxPollerOptions): void {
  const inFlightRef = useRef(false);
  const onInboxTurnRef = useRef(onInboxTurn);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onInboxTurnRef.current = onInboxTurn;
    onErrorRef.current = onError;
  }, [onError, onInboxTurn]);

  useEffect(() => {
    if (!sessionLoaded || !activeSessionId) return;

    let disposed = false;
    const tick = async () => {
      if (disposed || busy || inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const inbox = await window.desktopApi.pollLeadInbox(activeSessionId);
        if (!disposed && inbox.hasMessages && !busy) {
          const preview = inbox.preview.trim()
            || `${inbox.count} inbox message(s): ${inbox.types.join(", ")}`;
          await onInboxTurnRef.current(`[Inbox poller]\n${preview}`);
        }
      } catch (error) {
        onErrorRef.current?.(error);
      } finally {
        inFlightRef.current = false;
      }
    };

    const interval = window.setInterval(() => {
      void tick();
    }, 1_000);
    void tick();

    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [activeSessionId, busy, sessionLoaded]);
}
