import {
  findActiveToolPermissionCard,
  usePermissionCardManager,
} from "@shared/cards/display-card-managers";
import { type ReactNode, useRef } from "react";
import { ChatWorkspaceConversation } from "./ChatWorkspaceConversation";
import { ChatWorkspaceWelcome } from "./ChatWorkspaceWelcome";
import { CHAT_WORKSPACE_COPY_ZH_CN as copy } from "./chat-workspace-copy";
import type { ChatWorkspaceInputRuntime, ChatWorkspaceProps } from "./chat-workspace-types";
import { ChatScrollProvider } from "./useChatScroll";

export type { ChatWorkspaceProps } from "./chat-workspace-types";

export function ChatWorkspace(props: ChatWorkspaceProps): ReactNode {
  return (
    <ChatScrollProvider>
      <ChatWorkspaceContent {...props} />
    </ChatScrollProvider>
  );
}

function ChatWorkspaceContent({
  session,
  run,
  composer,
  deck,
  actions,
}: ChatWorkspaceProps): ReactNode {
  const activeRunStartedAtRef = useRef<number | null>(null);
  if (run.busy && activeRunStartedAtRef.current === null) {
    activeRunStartedAtRef.current = Date.now();
  } else if (!run.busy) {
    activeRunStartedAtRef.current = null;
  }

  const managedPermissionCards = usePermissionCardManager((state) => state.cards);
  const managedPermission = findActiveToolPermissionCard(managedPermissionCards, run.activeRunId);
  const pendingToolApproval =
    managedPermission?.event.kind === "permission.tool-requested"
      ? managedPermission.event.payload
      : undefined;
  const inputRuntime: ChatWorkspaceInputRuntime = {
    pendingToolApproval: pendingToolApproval
      ? {
          approvalId: pendingToolApproval.approvalId,
          toolName: pendingToolApproval.toolName,
          reason: pendingToolApproval.reason,
          detail: pendingToolApproval.detail,
        }
      : null,
    canCancelRun: Boolean(run.busy && run.activeRunId && run.onCancel),
    runStartedAt: activeRunStartedAtRef.current ?? undefined,
  };
  const title =
    session.conversationTitle?.trim() ||
    (session.isNewChat ? copy.newChatTitle : copy.currentChatTitle);

  if (session.isNewChat) {
    return (
      <ChatWorkspaceWelcome
        title={title}
        composer={composer}
        run={run}
        actions={actions}
        inputRuntime={inputRuntime}
      />
    );
  }

  return (
    <ChatWorkspaceConversation
      title={title}
      session={session}
      run={run}
      composer={composer}
      deck={deck}
      actions={actions}
      inputRuntime={inputRuntime}
    />
  );
}
