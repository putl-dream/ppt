import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { prepareToolResultData } from "../src/main/agent/runtime/tool-result-data";
import { ToolOutputValidationError, validateToolOutput } from "../src/main/agent/tools/tool-validation";
import type { ToolDefinition } from "../src/main/agent/tools/tool-definition";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("tool result data boundary", () => {
  it("keeps rich data locally and persists oversized provider content", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-ppt-tool-result-"));
    temporaryRoots.push(workspaceRoot);
    const data = { rows: [{ id: 1, value: "x".repeat(200) }] };

    const prepared = await prepareToolResultData({
      data,
      workspaceRoot,
      threadId: "thread/unsafe",
      toolUseId: "call:1",
      toolName: "ReadSnapshot",
      maxChars: 100,
    });

    expect(prepared.data).toBe(data);
    expect(prepared.truncated).toBe(true);
    expect(prepared.modelContent.length).toBeLessThan(300);
    expect(prepared.persistedPath).toMatch(/^\.agent\/tool-results\//);
    const stored = await readFile(join(workspaceRoot, prepared.persistedPath!), "utf8");
    expect(JSON.parse(stored)).toEqual(data);
  });

  it("injects a completion marker for empty results", async () => {
    const prepared = await prepareToolResultData({
      data: undefined,
      threadId: "thread",
      toolUseId: "call",
      toolName: "Noop",
    });

    expect(prepared.modelContent).toContain("completed successfully");
    expect(prepared.truncated).toBe(false);
  });

  it("validates declared output schemas at runtime", () => {
    const tool = {
      name: "TypedTool",
      outputSchema: z.object({ ok: z.literal(true) }),
    } as unknown as ToolDefinition<any, { ok: true }>;

    expect(validateToolOutput(tool, { ok: true })).toEqual({ ok: true });
    expect(() => validateToolOutput(tool, { ok: false })).toThrow(ToolOutputValidationError);
  });
});
