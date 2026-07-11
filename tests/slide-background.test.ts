import { describe, expect, it } from "vitest";
import {
  resolveLayoutBackgroundVariant,
} from "../src/shared/slide-background";

describe("slide-background", () => {
  it("maps cover/section to hero and content layouts to default", () => {
    expect(resolveLayoutBackgroundVariant("cover")).toBe("hero");
    expect(resolveLayoutBackgroundVariant("section")).toBe("hero");
    expect(resolveLayoutBackgroundVariant("concept")).toBe("default");
    expect(resolveLayoutBackgroundVariant("case")).toBe("default");
  });
});
