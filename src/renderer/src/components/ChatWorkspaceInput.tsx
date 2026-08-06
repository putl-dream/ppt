import type React from "react";
import type {
  ChatWorkspaceActions,
  ChatWorkspaceComposer,
  ChatWorkspaceInputRuntime,
  ChatWorkspaceRun,
} from "./chat-workspace-types";
import { UnifiedAgentInput } from "./UnifiedAgentInput";

interface ChatWorkspaceInputProps {
  composer: ChatWorkspaceComposer;
  run: ChatWorkspaceRun;
  actions: ChatWorkspaceActions;
  runtime: ChatWorkspaceInputRuntime;
  layoutMode: "center" | "bottom";
  sandboxReady: boolean;
  onPrepareWorkspace?: () => void;
}

export const ChatWorkspaceInput: React.FC<ChatWorkspaceInputProps> = ({
  composer,
  run,
  actions,
  runtime,
  layoutMode,
  sandboxReady,
  onPrepareWorkspace,
}) => (
  <UnifiedAgentInput
    request={composer.request}
    onChangeRequest={composer.onChangeRequest}
    onSubmitRequest={composer.onSubmitRequest}
    busy={run.busy}
    models={composer.models}
    selectedModelId={composer.selectedModelId}
    setSelectedModelId={composer.onSelectModel}
    layoutMode={layoutMode}
    pendingToolApproval={runtime.pendingToolApproval}
    onResolveToolApproval={actions.onResolveToolApproval}
    canCancelRun={runtime.canCancelRun}
    onCancelRun={run.onCancel}
    isCancellingRun={run.isCancelling ?? false}
    sandboxReady={sandboxReady}
    onPrepareWorkspace={onPrepareWorkspace}
    agentRunPhase={run.phase}
    activityTrace={run.activityTrace}
    runStartedAt={runtime.runStartedAt}
  />
);
