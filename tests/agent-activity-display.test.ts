import { describe, expect, it } from "vitest";
import {
  formatAgentProgressMessage,
  formatAgentToolActivity,
  formatAgentToolApprovalDetail,
  formatPublicErrorMessage,
  getAgentToolDisplayCopy,
  hasAgentToolDisplayCopy,
  inferAgentToolActivityState,
} from "../src/shared/agent-activity-display";
import { createDefaultToolRegistry } from "../src/main/agent/tools/tool-registry";
import { SUB_AGENT_TOOLS } from "../src/main/agent/subagent/workspace-tools";
import {
  formatTaskOwnerForDisplay,
  formatTaskPlanPosition,
  type AgentTaskNode,
} from "../src/shared/agent-task-graph";

describe("agent activity display", () => {
  it("covers every registered main and sub-agent tool", () => {
    const registry = createDefaultToolRegistry();
    const tools = [
      ...registry.getCoreTools(),
      ...registry.getDeferredTools(),
      ...SUB_AGENT_TOOLS,
    ];

    for (const tool of tools) {
      expect(hasAgentToolDisplayCopy(tool.name), tool.name).toBe(true);
      expect(getAgentToolDisplayCopy(tool.name).action).not.toBe(tool.name);
    }
  });

  it("uses natural status copy and a safe fallback for unknown tools", () => {
    expect(formatAgentToolActivity("PreviewCommands", "running")).toBe("正在检查修改方案…");
    expect(formatAgentToolActivity("PreviewCommands", "completed")).toBe("已检查修改方案");
    expect(formatAgentToolActivity("PreviewCommands", "failed")).toBe("检查修改方案未完成");
    expect(formatAgentToolActivity("InternalFoo_v2", "completed")).toBe("已处理当前任务");
    expect(formatAgentToolActivity("InternalFoo_v2", "completed")).not.toContain("InternalFoo_v2");
  });

  it("distinguishes failures, denials, and invalid input from completion events", () => {
    expect(inferAgentToolActivityState("工具 ExportPptx 执行失败: EACCES", "completed"))
      .toBe("failed");
    expect(inferAgentToolActivityState("工具 bash 被拒绝", "completed")).toBe("denied");
    expect(inferAgentToolActivityState("参数 JSON 解析失败", "completed")).toBe("invalid-input");
    expect(inferAgentToolActivityState("执行本地操作已取消", "completed")).toBe("denied");
    expect(inferAgentToolActivityState("检查修改方案暂未执行：输入信息有误", "completed"))
      .toBe("invalid-input");
  });

  it("normalizes internal diagnostics and legacy progress labels", () => {
    expect(formatAgentProgressMessage(
      "L2 micro_compact: older tool results replaced with placeholders.",
    )).toBe("已精简较早的运行记录");
    expect(formatAgentProgressMessage(
      "L4 compact_history skipped: compact_history circuit breaker open",
    )).toBeNull();
    expect(formatAgentProgressMessage(
      "输出被截断，提升 max_tokens 至 65536 后重试。",
    )).toBe("回复内容较长，正在继续生成…");
    expect(formatAgentProgressMessage(
      "后台任务 bg_0001 已启动：ExportPptx: pptx",
    )).toBe("已开始后台处理：导出演示文稿");
    expect(formatAgentProgressMessage(
      "✅ 工具 PreviewCommands 运行完毕",
    )).toBe("已检查修改方案");
  });

  it("keeps approval impact readable without exposing raw JSON fallbacks", () => {
    expect(formatAgentToolApprovalDetail("path: slides/cover.md"))
      .toBe("位置：slides/cover.md");
    expect(formatAgentToolApprovalDetail('{"internal_flag":true}'))
      .toBe("此操作包含需要确认的高级设置");
  });

  it("converts infrastructure errors into actionable public messages", () => {
    expect(formatPublicErrorMessage(new Error("OPENAI_API_KEY missing")))
      .toBe("模型服务尚未正确配置，请在设置中检查连接信息。");
    expect(formatPublicErrorMessage(new Error("Zod validation failed"), "请重试。"))
      .toBe("请重试。");
    expect(formatPublicErrorMessage(new Error("Session not found"), "无法恢复会话。"))
      .toBe("无法恢复会话。");
  });

  it("hides Lean DeckSpec diagnostics behind an actionable public message", () => {
    const error = new Error(
      "Error invoking remote method 'agent:start': ModelOutputError: "
      + "Lean DeckSpec 校验失败；为保持单次调用承诺，本次不会自动重试："
      + "Unrecognized key: \"language\"; Invalid input: expected 1 at version",
    );

    const message = formatPublicErrorMessage(error, "请重试。");
    expect(message).toBe(
      "模型未按 Lean Mode 契约返回内容。本次未自动重试，也未修改 PPT；请重新生成。",
    );
    expect(message).not.toContain("ModelOutputError");
    expect(message).not.toContain("language");
    expect(formatPublicErrorMessage(
      "Lean Mode 未通过唯一的 DeckSpec 提交工具返回结果；本次不会自动重试。",
      "请重试。",
    )).toBe(
      "模型未按 Lean Mode 契约返回内容。本次未自动重试，也未修改 PPT；请重新生成。",
    );
  });

  it("replaces internal task owner ids with collaboration roles", () => {
    const task: AgentTaskNode = {
      id: "task-1",
      subject: "整理内容",
      description: "",
      status: "in_progress",
      executionTarget: "teammate",
      owner: "teammate-019f51ff",
      blockedBy: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    expect(formatTaskOwnerForDisplay(task)).toBe("协作助手");
    expect(formatTaskPlanPosition([task])).toContain("协作助手");
    expect(formatTaskPlanPosition([task])).not.toContain("teammate-019f51ff");

    const legacyLeadTask = {
      ...task,
      executionTarget: undefined,
      owner: "custom-lead-owner",
    };
    expect(formatTaskOwnerForDisplay(legacyLeadTask)).toBe("主助手");
  });
});
