import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts", "electron/**/*.test.ts"],
    exclude: ["**/._*"]
  }
});
