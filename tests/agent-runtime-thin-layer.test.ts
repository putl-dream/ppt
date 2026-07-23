import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const runtimeRoot = join(process.cwd(), "src", "main", "agent", "runtime");

async function source(file: string): Promise<string> {
  return await readFile(join(runtimeRoot, file), "utf8");
}

describe("AgentRuntime thin-layer architecture", () => {
  it("keeps the public runtime facade on the five lifecycle actions", async () => {
    const runtime = await source("agent-runtime.ts");

    expect(runtime).toContain("this.runFactory.open(options)");
    expect(runtime).toContain("this.runFactory.prepare(scope)");
    expect(runtime).toContain("this.loopDriver.run(prepared.run)");
    expect(runtime).toContain("this.finalizer.complete");
    expect(runtime).toContain("scope.close()");
    expect(runtime).not.toMatch(
      /layout-choice-orchestrator|model-call-recovery|presentation-completion-policy|task-graph-tools|tool-preflight/,
    );
  });

  it("keeps Presentation policy and display text out of the stable loop driver", async () => {
    const driver = await source("agent-loop-driver.ts");

    expect(driver).not.toMatch(/SubmitCommands|AskUser|TaskGraph|workflow-progress|正在|Presentation/);
    expect(driver).not.toMatch(/presentation-completion-policy|layout-choice-orchestrator/);
  });

  it("keeps application-level Runtime options out of model turns", async () => {
    const turns = await Promise.all([
      source("turns/model-turn-runner.ts"),
      source("turns/tool-turn-runner.ts"),
    ]);
    const combined = turns.join("\n");

    expect(combined).not.toMatch(/scope\.options|options\.(?:request|messageHistory|model|runtimeRoot|onStreamChunk)/);
  });

  it("keeps query messages and tool-batch state out of AgentSession", async () => {
    const collaborators = [
      "lifecycle/agent-run-scope.ts",
      "agent-run-finalizer.ts",
      "turns/prepared-agent-run.ts",
      "presentation-agent-run-factory.ts",
      "turns/model-turn-runner.ts",
      "turns/tool-turn-runner.ts",
      "agent-loop-driver.ts",
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
});
