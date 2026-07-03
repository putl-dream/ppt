import { describe, expect, it } from "vitest";
import { formatToolApprovalDetail } from "../src/main/agent/runtime/format-tool-approval";

describe("formatToolApprovalDetail", () => {
  it("formats bash commands", () => {
    expect(formatToolApprovalDetail("bash", { command: "rm notes.md" }))
      .toBe("rm notes.md");
  });

  it("formats write_file with truncated content", () => {
    const content = "a".repeat(300);
    const detail = formatToolApprovalDetail("write_file", { path: "x.md", content });
    expect(detail).toContain("path: x.md");
    expect(detail).toContain("...");
  });
});
