import { describe, expect, it } from "vitest";
import {
  isRuntimeCancellation,
  rethrowIfRuntimeCancellation,
} from "../src/main/agent/runtime/lifecycle/runtime-cancellation";

describe("runtime cancellation classification", () => {
  it("prioritizes an aborted signal over an ordinary downstream error", () => {
    const controller = new AbortController();
    controller.abort("cancelled by user");
    expect(isRuntimeCancellation(new Error("tool failed"), controller.signal)).toBe(true);
  });

  it("recognizes standard abort-shaped errors without an attached signal", () => {
    expect(isRuntimeCancellation(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(true);
    expect(isRuntimeCancellation(Object.assign(new Error("aborted"), { code: "ABORT_ERR" }))).toBe(true);
  });

  it("does not reclassify an ordinary tool failure", () => {
    const error = new Error("ordinary failure");
    expect(isRuntimeCancellation(error)).toBe(false);
    expect(() => rethrowIfRuntimeCancellation(error)).not.toThrow();
  });
});
