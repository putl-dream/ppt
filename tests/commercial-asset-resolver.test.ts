import { describe, expect, it } from "vitest";

import {
  cropAroundFocalPoint,
  inferFocalPointFromBrief,
} from "../src/main/agent/assets/commercial-asset-resolver";

describe("commercial asset focal cropping", () => {
  it("infers an explicitly requested subject position", () => {
    expect(inferFocalPointFromBrief("professional portrait, subject on the right")).toEqual({
      x: 0.7,
      y: 0.5,
    });
    expect(inferFocalPointFromBrief("产品主体靠左、靠上，保留右侧文案空间")).toEqual({
      x: 0.3,
      y: 0.3,
    });
  });

  it("keeps the focal point inside a bounded aspect crop", () => {
    const crop = cropAroundFocalPoint(2400, 1200, 1, { x: 0.8, y: 0.5 });
    expect(crop).toEqual({ x: 0.5, y: 0, width: 0.5, height: 1 });
    expect(crop.x + crop.width).toBeLessThanOrEqual(1);
  });
});
