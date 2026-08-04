import type React from "react";
import { CHAT_WORKSPACE_COPY_ZH_CN as copy } from "./chat-workspace-copy";
import { ChatWorkspaceInput } from "./ChatWorkspaceInput";
import type {
  ChatWorkspaceActions,
  ChatWorkspaceComposer,
  ChatWorkspaceInputRuntime,
  ChatWorkspaceRun,
} from "./chat-workspace-types";

interface ChatWorkspaceWelcomeProps {
  title: string;
  composer: ChatWorkspaceComposer;
  run: ChatWorkspaceRun;
  actions: ChatWorkspaceActions;
  inputRuntime: ChatWorkspaceInputRuntime;
}

export const ChatWorkspaceWelcome: React.FC<ChatWorkspaceWelcomeProps> = ({
  title,
  composer,
  run,
  actions,
  inputRuntime,
}) => (
  <section className="canvas-column chat-workspace-column center-focal-wrapper view-enter">
    <div className="panel-header canvas-header center-focal-header">
      <div className="canvas-header-left">
        <div className="chat-session-title" title={title}>
          <span>{title}</span>
        </div>
      </div>
      <div className="canvas-header-right" />
    </div>

    <div className="center-focal-content-area">
      <ChatWorkspaceInput
        composer={composer}
        run={run}
        actions={actions}
        runtime={inputRuntime}
        layoutMode="center"
        sandboxReady={composer.workspaceReady}
        onPrepareWorkspace={composer.onPrepareWorkspace}
      />

      <div className="center-suggestions">
        {copy.suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="suggestion-chip"
            onClick={() => composer.onProposePrompt(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  </section>
);
