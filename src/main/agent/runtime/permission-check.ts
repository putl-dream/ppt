import type { HookCallback } from "./hook-registry";
import {
  evaluateToolPermission,
  type PermissionDecision,
  type ToolPermissionBlock,
} from "./tool-access-policy";

export type ToolApprovalRequest = {
  toolName: string;
  args: unknown;
  reason: string;
};

export type ToolApprovalHandler = (request: ToolApprovalRequest) => Promise<boolean>;

export type { PermissionDecision } from "./tool-access-policy";

export interface PreToolUseBlock extends ToolPermissionBlock {
  event: "PreToolUse";
  scope: "main" | "subagent";
  threadId?: string;
  requestToolApproval?: ToolApprovalHandler;
}

/** 三道闸门顺序固定：硬拒绝 → 规则匹配 → 用户审批。 */
export function evaluatePermission(block: PreToolUseBlock): PermissionDecision {
  return evaluateToolPermission(block);
}

export function createPermissionPreToolUseHook(): HookCallback {
  return async (block) => {
    const preBlock = block as PreToolUseBlock;
    const decision = evaluatePermission(preBlock);

    if (decision.type === "deny") {
      return { type: "stop", reason: decision.reason, toolDenied: true };
    }

    if (decision.type === "require_approval") {
      const handler = preBlock.requestToolApproval;
      if (!handler) {
        return {
          type: "stop",
          reason: `操作需要用户确认：${decision.reason}`,
          toolDenied: true,
        };
      }
      const approved = await handler({
        toolName: preBlock.toolName,
        args: preBlock.args,
        reason: decision.reason,
      });
      if (!approved) {
        return { type: "stop", reason: "用户拒绝了该工具操作。", toolDenied: true };
      }
    }

    return null;
  };
}
