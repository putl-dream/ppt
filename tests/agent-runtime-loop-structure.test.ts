import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const runtimeRoot = join(process.cwd(), "src", "main", "agent", "runtime");

async function source(file: string): Promise<string> {
  return await readFile(join(runtimeRoot, file), "utf8");
}

describe("AgentRuntime query-loop structure", () => {
  it("keeps state, model calls, tool batches, and state commits in one readable loop", async () => {
    const runtime = await source("agent-runtime.ts");

    expect(runtime).toContain("let state = run.initialState");
    expect(runtime).toContain("while (true)");
    expect(runtime).toContain("this.modelTurns.run(run, state, workspace)");
    expect(runtime).toContain("workspace.toolUseBlocks");
    expect(runtime).toContain("this.toolTurns.runBatch");
    expect(runtime).toContain("state = reduceQueryState(");
    expect(runtime).not.toContain("AgentLoopDriver");

    const modelIndex = runtime.indexOf("this.modelTurns.run(run, state, workspace)");
    const toolsIndex = runtime.indexOf("this.toolTurns.runBatch", modelIndex);
    const stateIndex = runtime.indexOf("state = reduceQueryState(", toolsIndex);
    expect(modelIndex).toBeGreaterThan(-1);
    expect(toolsIndex).toBeGreaterThan(modelIndex);
    expect(stateIndex).toBeGreaterThan(toolsIndex);
  });

  it("keeps query messages and tool-batch state out of AgentSession", async () => {
    const collaborators = [
      "lifecycle/agent-run-scope.ts",
      "agent-run-finalizer.ts",
      "turns/prepared-agent-run.ts",
      "presentation-agent-run-factory.ts",
      "turns/model-turn-runner.ts",
      "turns/tool-turn-runner.ts",
      "agent-runtime.ts",
      "background/lead-inbox-input-source.ts",
      "lifecycle/agent-event-ports.ts",
    ];
    const combined = (await Promise.all(collaborators.map(source))).join("\n");
    const session = await source("lifecycle/agent-session.ts");

    expect(combined).not.toMatch(
      /session\.(?:modelMessages|queuedToolUses|pendingToolResults|renderFeedbackUsed|validationFailuresByTool)/,
    );
    expect(session).not.toMatch(
      /modelMessagesValue|queuedToolUsesValue|pendingToolResultsValue|renderFeedbackUsedValue|validationFailuresByToolValue/,
    );
  });

  it("keeps application-level Runtime options out of turn runners", async () => {
    const turns = await Promise.all([
      source("turns/model-turn-runner.ts"),
      source("turns/tool-turn-runner.ts"),
    ]);

    expect(turns.join("\n")).not.toMatch(
      /scope\.options|options\.(?:request|messageHistory|model|runtimeRoot|onStreamChunk)/,
    );
  });
});
