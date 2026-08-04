import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CHAT_WORKSPACE_COPY_ZH_CN as copy, getChatPromptTemplates } from "./chat-workspace-copy";
import { ChatWorkspaceInput } from "./ChatWorkspaceInput";
import { InteractionCardHost } from "../cards/hosts/InteractionCardHost";
import type {
  ChatWorkspaceActions,
  ChatWorkspaceComposer as ComposerState,
  ChatWorkspaceDeck,
  ChatWorkspaceInputRuntime,
  ChatWorkspaceRun,
} from "./chat-workspace-types";

interface ChatWorkspaceComposerProps {
  composer: ComposerState;
  run: ChatWorkspaceRun;
  deck: ChatWorkspaceDeck;
  actions: ChatWorkspaceActions;
  inputRuntime: ChatWorkspaceInputRuntime;
  viewingTeamSession: boolean;
}

export function ChatWorkspaceComposer({
  composer,
  run,
  deck,
  actions,
  inputRuntime,
  viewingTeamSession,
}: ChatWorkspaceComposerProps): ReactNode {
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const promptTemplates = useMemo(
    () => getChatPromptTemplates(deck.presentation, deck.selectedSlideId),
    [deck.presentation, deck.selectedSlideId],
  );

  useEffect(() => {
    setShowSlashMenu(composer.request.startsWith("/"));
  }, [composer.request]);

  const selectTemplate = (command: string) => {
    composer.onChangeRequest(command);
    setShowSlashMenu(false);
  };

  return (
    <div className="right-panel-footer chat-workspace-footer-unified">
      <div className="chat-conversation-shell chat-conversation-footer">
        {showSlashMenu && !inputRuntime.pendingToolApproval && (
          <div className="slash-menu-popup" role="listbox" aria-label={copy.promptTemplateAria}>
            <div className="slash-menu-header">{copy.promptTemplateHeader}</div>
            {promptTemplates.map((template) => (
              <button
                type="button"
                key={template.command}
                className="slash-menu-item"
                onClick={() => selectTemplate(template.command)}
              >
                <span className="cmd-text">{template.command}</span>
                <span className="cmd-desc">{template.description}</span>
              </button>
            ))}
          </div>
        )}

        <div>
          <InteractionCardHost
            host="composer-before-input"
            busy={run.busy}
            onResolveQuestion={actions.onResolveQuestion}
          />
          {viewingTeamSession && !inputRuntime.pendingToolApproval && (
            <div className="team-focus-composer-note">{copy.teammateComposerNote}</div>
          )}
          <ChatWorkspaceInput
            composer={composer}
            run={run}
            actions={actions}
            runtime={inputRuntime}
            layoutMode="bottom"
            sandboxReady
          />
        </div>
      </div>
    </div>
  );
}
