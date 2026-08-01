import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DESIGN_PRESETS } from "../src/design-system";

import { CommitGate } from "../src/main/agent/gate/commit-gate";
import { RiskPolicy } from "../src/main/agent/gate/risk-policy";
import { AgentService } from "../src/main/agent/service";
import { FileSessionStore } from "../src/main/session-store";
import { AgentRuntime } from "../src/main/agent/runtime/agent-runtime";
import { ToolRegistry } from "../src/main/agent/tools/tool-registry";
import type {
  AgentModelGateway,
  AgentModelRequest,
  AgentModelResponse,
  AgentModelStreamChunk,
} from "../src/main/agent/gateway/types";
import { CommandBus, executeCommand } from "../src/shared/commands";
import { agentRunRequestSchema } from "../src/shared/ipc";
import {
  compileLeanDeckSpec,
  leanDeckSpecSchema,
  type LeanDeckSpec,
  type LeanSlideSpec,
} from "../src/shared/lean-mode";
import {
  createStarterPresentation,
  presentationSchema,
} from "../src/shared/presentation";

function slide(
  input: Pick<LeanSlideSpec, "kind" | "purpose" | "title"> & Partial<LeanSlideSpec>,
): LeanSlideSpec {
  return {
    kind: input.kind,
    purpose: input.purpose,
    title: input.title,
    subtitle: input.subtitle ?? "",
    items: input.items ?? [],
    left: input.left ?? null,
    right: input.right ?? null,
    steps: input.steps ?? [],
    metric: input.metric ?? null,
    chart: input.chart ?? null,
    sourceRefs: input.sourceRefs ?? [],
  };
}

function createSpec(): LeanDeckSpec {
  return {
    version: 1,
    title: "增长经营复盘",
    locale: "zh-CN",
    scenario: "internal-report",
    audience: "公司管理层",
    objective: "说明增长质量并确认下一阶段资源配置",
    desiredAction: "批准三项增长实验",
    durationMinutes: 12,
    designPreset: "swiss-minimal",
    sources: [{
      id: "forecast",
      label: "内部测算",
      asOf: "2026 Q2",
      provenance: "illustrative",
    }],
    slides: [
      slide({
        kind: "cover",
        purpose: "opening",
        title: "增长进入质量优先阶段",
        subtitle: "经营复盘与下一阶段行动建议",
      }),
      slide({
        kind: "bullets",
        purpose: "context",
        title: "规模增长仍在延续，但结构已经变化",
        items: [
          { heading: "客户结构", detail: "高价值客户贡献提升" },
          { heading: "渠道结构", detail: "自然流量成为主要增量" },
          { heading: "收入结构", detail: "续费收入占比继续提高" },
        ],
      }),
      slide({
        kind: "comparison",
        purpose: "insight",
        title: "增长逻辑从获客转向留存",
        left: {
          label: "过去",
          items: ["依赖投放", "关注新增", "短周期回收"],
        },
        right: {
          label: "现在",
          items: ["依赖产品价值", "关注留存", "长期复利"],
        },
      }),
      slide({
        kind: "metric",
        purpose: "proof",
        title: "续费提升是最确定的增长杠杆",
        metric: {
          value: "+18%",
          label: "续费收入提升空间",
          takeaway: "优先优化续费链路，比继续扩大投放更有效",
        },
        sourceRefs: ["forecast"],
      }),
      slide({
        kind: "process",
        purpose: "plan",
        title: "用三步验证增长假设",
        steps: [
          { heading: "聚焦", detail: "选择两个高价值客群" },
          { heading: "实验", detail: "上线分层续费方案" },
          { heading: "复盘", detail: "两周一次评估净收入留存" },
        ],
      }),
      slide({
        kind: "closing",
        purpose: "close",
        title: "下一阶段只做能验证的增长",
        subtitle: "把资源集中到留存与续费两个确定性杠杆",
        items: [
          { heading: "批准试验预算", detail: "" },
          { heading: "两周后复盘", detail: "" },
        ],
      }),
    ],
  };
}

class FakeGateway implements AgentModelGateway {
  readonly requests: AgentModelRequest[] = [];

  async generateText(request: AgentModelRequest): Promise<AgentModelResponse> {
    this.requests.push(request);
    return {
      provider: "openai",
      model: "test-model",
      content: [{ type: "text", text: "{}" }],
    };
  }

  async *generateTextStream(): AsyncIterable<AgentModelStreamChunk> {
    yield { type: "complete", content: [] };
  }
}

describe("Lean Mode shared contract", () => {
  it("defaults legacy Agent requests to Agent mode", () => {
    expect(agentRunRequestSchema.parse({
      prompt: "生成季度汇报",
      sessionId: "session-1",
    }).generationMode).toBe("agent");

    expect(agentRunRequestSchema.parse({
      prompt: "生成季度汇报",
      sessionId: "session-1",
      generationMode: "lean",
    }).generationMode).toBe("lean");
  });

  it("rejects nine-slide decks without agenda via shared schema", () => {
    const base = createSpec();
    const extraSlides = [
      slide({
        kind: "bullets",
        purpose: "insight",
        title: "结构变化带来新的增长窗口",
        items: [
          { heading: "窗口一", detail: "高价值客户需求增强" },
          { heading: "窗口二", detail: "自然流量效率提升" },
        ],
      }),
      slide({
        kind: "comparison",
        purpose: "context",
        title: "两个客群的增长方式不同",
        left: { label: "成熟客群", items: ["重续费", "重服务"] },
        right: { label: "新兴客群", items: ["重激活", "重产品"] },
      }),
      slide({
        kind: "process",
        purpose: "plan",
        title: "实验按周推进",
        steps: [
          { heading: "设计", detail: "定义假设" },
          { heading: "上线", detail: "小流量验证" },
        ],
      }),
    ];
    const invalidNine = {
      ...base,
      slides: [
        ...base.slides.slice(0, -1),
        ...extraSlides,
        base.slides.at(-1)!,
      ],
    };
    const result = leanDeckSpecSchema.safeParse(invalidNine);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected nine-slide deck without agenda to fail.");
    expect(result.error.issues.some((issue) => issue.message.includes("agenda"))).toBe(true);
  });

  it("compiles one DeckSpec deterministically into a valid replacement deck", () => {
    const starter = createStarterPresentation();
    const first = compileLeanDeckSpec(createSpec(), starter);
    const second = compileLeanDeckSpec(createSpec(), starter);

    expect(presentationSchema.safeParse(first.presentation).success).toBe(true);
    expect(first.presentation).toEqual(second.presentation);
    expect(first.commands).toEqual(second.commands);
    expect(first.presentation.slides).toHaveLength(6);
    expect(first.presentation.slides.map((item) => item.layout)).toEqual([
      "cover",
      "concept",
      "comparison",
      "case",
      "process",
      "summary",
    ]);

    let staged = starter;
    for (const command of first.commands) {
      staged = executeCommand(staged, command).presentation;
    }
    expect(staged.title).toBe(first.presentation.title);
    expect(staged.designSystem).toEqual(first.presentation.designSystem);
    expect(staged.slides).toEqual(first.presentation.slides);
    expect(staged.slides.some((item) =>
      item.elements.some((element) =>
        element.type === "text" && element.text.includes("示意数据")
      )
    )).toBe(true);
  });

  it("passes the existing CommitGate and requires preview approval", async () => {
    const starter = createStarterPresentation();
    const compiled = compileLeanDeckSpec(createSpec(), starter);
    const result = await new CommitGate(new RiskPolicy()).evaluate(
      starter,
      compiled.commands,
      "high",
    );

    expect(result.success, result.errors.join("\n")).toBe(true);
    expect(result.preview?.slides).toHaveLength(6);
    expect(result.decision).toBe("REQUIRES_APPROVAL");
  });

  it.each(DESIGN_PRESETS)(
    "stays inside CommitGate boundaries with the $id design system",
    async (preset) => {
      const starter = createStarterPresentation();
      const compiled = compileLeanDeckSpec(createSpec(), starter, preset.system);
      const result = await new CommitGate(new RiskPolicy()).evaluate(
        starter,
        compiled.commands,
        "high",
      );

      expect(result.success, result.errors.join("\n")).toBe(true);
    },
  );

  it("fails closed when an offline direct proposal has no lifecycle repository", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "lean-approval-"));
    const starter = createStarterPresentation();
    const compiled = compileLeanDeckSpec(createSpec(), starter);
    const commandBus = new CommandBus(starter);
    const runtime = new AgentRuntime(new ToolRegistry(), new FakeGateway());
    const service = new AgentService(
      commandBus,
      runtime,
      new CommitGate(new RiskPolicy()),
      workspaceRoot,
    );

    try {
      await expect(service.submitDirectProposal({
        threadId: "lean-thread",
        request: "生成经营复盘",
        commands: compiled.commands,
        summary: "Lean 草稿已生成",
        assumptions: ["一次调用"],
        risk: "high",
      })).rejects.toThrow(
        "Presentation proposals require the durable lifecycle repository",
      );
      expect(commandBus.getSnapshot()).toEqual(starter);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("persists Lean metrics in the authoritative assistant message", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lean-session-metrics-"));
    const store = new FileSessionStore(
      join(directory, "conversations.sqlite"),
      join(directory, "projects"),
    );
    try {
      await store.initialize();
      const created = await store.createSession({ title: "Lean metrics" });
      const sessionId = created.activeSession!.session.id;
      await store.saveMessages(sessionId, [{
        id: "lean-placeholder",
        role: "assistant",
        content: "",
        threadId: "lean-run",
      }]);
      await store.finalizeAgentRunMessage(sessionId, "lean-run", {
        status: "approval-required",
        approval: {
          jobId: "job-lean",
          queryId: "query-lean",
          proposalId: "proposal-lean",
          threadId: "lean-run",
          summary: "Lean Mode 已生成",
          commands: [],
          risk: "high",
        },
        leanMetrics: {
          mode: "lean",
          modelCalls: 1,
          provider: "openai",
          model: "test",
          inputTokens: 1_200,
          outputTokens: 800,
          totalTokens: 2_000,
          cachedInputTokens: 100,
          durationMs: 2_500,
          compileDurationMs: 12,
          slideCount: 6,
          requestChars: 12,
          specChars: 3_000,
        },
      });

      const content = store.getSession(sessionId).messages.at(-1)?.content ?? "";
      expect(content).toContain("1 次模型调用");
      expect(content).toContain("2,000 tokens");
      expect(content).toContain("2.5 秒");
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
