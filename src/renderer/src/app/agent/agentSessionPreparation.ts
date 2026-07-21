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

/**
 * 确保本次运行拥有持久化 session。
 * 会话创建及其失败反馈在此闭环，避免消息构造和 Agent 执行逻辑感知草稿会话状态。
 */
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
