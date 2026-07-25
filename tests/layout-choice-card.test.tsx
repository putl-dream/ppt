import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LayoutChoiceCard } from "../src/renderer/src/components/LayoutChoiceCard";
import { TEST_DESIGN_SYSTEM } from "./design-engine-test-utils";

describe("LayoutChoiceCard", () => {
  it("uses an independent radio group for every card instance", () => {
    const markup = renderToStaticMarkup(
      <>
        <LayoutChoiceCard
          slideCount={7}
          layoutMode="creative"
          selectedDesignSystem={TEST_DESIGN_SYSTEM}
        />
        <LayoutChoiceCard
          slideCount={7}
          layoutMode="creative"
          selectedDesignSystem={TEST_DESIGN_SYSTEM}
        />
      </>,
    );

    const names = [...markup.matchAll(/name="([^"]+)"/g)].map((match) => match[1]);
    expect(names).toHaveLength(4);
    expect(new Set(names).size).toBe(2);
    expect(names[0]).toBe(names[1]);
    expect(names[2]).toBe(names[3]);
    expect(names[0]).not.toBe(names[2]);
  });

  it("replaces the controls with a resolved summary after confirmation", () => {
    const markup = renderToStaticMarkup(
      <LayoutChoiceCard
        slideCount={8}
        resolved="confirmed"
        layoutMode="template"
        selectedDesignSystem={TEST_DESIGN_SYSTEM}
      />,
    );

    expect(markup).toContain("已确认");
    expect(markup).toContain("标准排版");
    expect(markup).not.toContain("确认并排版");
    expect(markup).not.toContain('type="radio"');
  });
});
