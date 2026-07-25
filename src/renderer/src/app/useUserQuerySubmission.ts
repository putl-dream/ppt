import { useCallback, type Dispatch, type SetStateAction } from "react";
import { createLockedLayoutChoice } from "@shared/layout-preference";
import type { LeanGenerationMode } from "@shared/lean-mode-contract";
import type { Presentation } from "@shared/presentation";
import type { DesignSystemV2 } from "@design-system";
import type { ChatMessage } from "./chatMessageRuntime";
import type { AgentRunController } from "./agent/useAgentRunController";
import { tryHandleLocalQueryCommand } from "./localQueryCommand";

interface UseUserQuerySubmissionOptions {
  request: string;
  busy: boolean;
  generationMode: LeanGenerationMode;
  selectedDesignSystem: DesignSystemV2;
  presentation?: Presentation;
  activeSessionId: string;
  setRequest: Dispatch<SetStateAction<string>>;
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  openDeckPreview: () => void;
  notify: (message: string) => void;
  startAgent: AgentRunController["startAgent"];
}

/**
 * 用户主动提交 query 的前端能力边界：先消费纯前端命令，其余输入才交给 Agent。
 * 重试、编辑重发和后台回合不经过这里，因此不会被自然语言 UI 命令误拦截。
 */
export function useUserQuerySubmission({
  request,
  busy,
  generationMode,
  selectedDesignSystem,
  presentation,
  activeSessionId,
  setRequest,
  setChatMessages,
  openDeckPreview,
  notify,
  startAgent,
}: UseUserQuerySubmissionOptions): () => void {
  return useCallback(() => {
    if (!request.trim() || busy) return;

    const handledLocally = tryHandleLocalQueryCommand({
      prompt: request,
      presentation,
      sessionId: activeSessionId,
      appendChatMessage: (message) => {
        setChatMessages((current) => [...current, message]);
      },
      clearRequest: () => setRequest(""),
      openDeckPreview,
      notify,
    });
    if (handledLocally) return;

    void startAgent(undefined, undefined, {
      generationMode,
      ...(generationMode === "lean"
        ? {
            layoutChoice: createLockedLayoutChoice({
              audience: "Lean 请求中定义的目标受众",
              objective: `生成“${presentation?.title ?? "新演示文稿"}”`,
              desiredOutcome: "形成可评审、可继续编辑的完整演示",
              coreMessage: request.trim().slice(0, 240),
              deliveryContext: "Lean 单次生成",
              afterUse: "用于预览、评审与后续修改",
            }, selectedDesignSystem, "Lean 模式沿用用户当前明确选择的设计系统。"),
          }
        : {}),
    });
  }, [
    activeSessionId,
    busy,
    generationMode,
    notify,
    openDeckPreview,
    presentation,
    request,
    selectedDesignSystem,
    setChatMessages,
    setRequest,
    startAgent,
  ]);
}
