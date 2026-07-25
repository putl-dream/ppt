import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LayoutChoiceCard } from "../src/renderer/src/components/LayoutChoiceCard";
import { resolveDesignPlan } from "../src/shared/design-recommendation";
import { confirmDesignPlan } from "../src/shared/layout-preference";

const candidate = resolveDesignPlan({
  communicationContract: {
    audience: "CTO",
    objective: "申请批准 AI 开发工具试点",
    desiredOutcome: "批准 90 天试点",
    coreMessage: "治理边界内的 AI 工具能提升交付速度",
    deliveryContext: "20 分钟现场汇报",
    afterUse: "作为试点决策记录",
  },
  sourceText: "AI developer architecture",
});

describe("LayoutChoiceCard", () => {
  it("uses an independent radio group for every card instance", () => {
    const markup = renderToStaticMarkup(
      <>
        <LayoutChoiceCard slideCount={7} candidate={candidate} />
        <LayoutChoiceCard slideCount={7} candidate={candidate} />
      </>,
    );

    const names = [...markup.matchAll(/name="([^"]+)"/g)].map((match) => match[1]);
    expect(names).toHaveLength(6);
    expect(new Set(names).size).toBe(2);
    expect(new Set(names.slice(0, 3)).size).toBe(1);
    expect(new Set(names.slice(3)).size).toBe(1);
    expect(names[0]).not.toBe(names[3]);
  });

  it("replaces the controls with a resolved direction summary", () => {
    const choice = confirmDesignPlan(candidate, "direction-shifted");
    const markup = renderToStaticMarkup(
      <LayoutChoiceCard
        slideCount={8}
        candidate={candidate}
        resolvedChoice={choice}
      />,
    );

    expect(markup).toContain("已确认");
    expect(markup).toContain("蓝图");
    expect(markup).not.toContain("确认方向并开始设计");
    expect(markup).not.toContain('type="radio"');
  });
});
