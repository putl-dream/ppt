import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve("src/shared"),
      "@design-system": resolve("src/design-system"),
      "@main": resolve("src/main"),
    },
  },
  test: {
    environment: "node",
  },
});
