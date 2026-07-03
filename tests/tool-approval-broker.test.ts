import { describe, expect, it, vi } from "vitest";
import { ToolApprovalBroker } from "../src/main/agent/runtime/tool-approval-broker";

describe("ToolApprovalBroker", () => {
  it("waits for resolve before returning approval decision", async () => {
    const broker = new ToolApprovalBroker();
    const emit = vi.fn();
    const handler = broker.createHandler("run-1", emit);

    const pending = handler({
      toolName: "bash",
      args: { command: "echo hi" },
      reason: "Shell 命令：echo hi",
    });

    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      type: "tool-approval-waiting",
      toolName: "bash",
      reason: "Shell 命令：echo hi",
    }));

    const approvalId = emit.mock.calls[0]![0].approvalId as string;
    expect(broker.resolve(approvalId, true)).toBe(true);
    await expect(pending).resolves.toBe(true);
  });

  it("cancels pending approvals when a run is aborted", async () => {
    const broker = new ToolApprovalBroker();
    const handler = broker.createHandler("run-2", () => {});
    const pending = handler({
      toolName: "write_file",
      args: { path: "a.md", content: "x" },
      reason: "文件修改",
    });

    broker.cancelForRun("run-2");
    await expect(pending).resolves.toBe(false);
  });
});
