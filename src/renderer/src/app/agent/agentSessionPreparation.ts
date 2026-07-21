import { formatPublicErrorMessage } from "@shared/agent-activity-display";
import { createSessionTitleFromPrompt, type SessionBootstrap } from "@shared/session";

interface EnsureAgentSessionOptions {
  activeSessionId: string;
  prompt: string;
  localStoragePath: string;
  applySessionState: (state: SessionBootstrap) => void;
  setIsDraftChat: (isDraft: boolean) => void;
  notify: (message: string) => void;
}

/** Ensures the run has a persisted session and owns session-creation failures. */
export async function ensureAgentSession({
  activeSessionId,
  prompt,
  localStoragePath,
  applySessionState,
  setIsDraftChat,
  notify,
}: EnsureAgentSessionOptions): Promise<string | undefined> {
  if (activeSessionId) return activeSessionId;

  try {
    const title = createSessionTitleFromPrompt(prompt);
    const state = await window.desktopApi.createSession(
      localStoragePath
        ? { rootPath: localStoragePath, title }
        : { title },
    );
    applySessionState(state);
    setIsDraftChat(false);
    return state.activeSession!.session.id;
  } catch (error) {
    setIsDraftChat(true);
    notify(formatPublicErrorMessage(error, "创建会话失败，请重试。"));
    return undefined;
  }
}
