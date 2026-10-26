import { defineConfig } from "vitest/config";
import package_ from "./package.json" with { type: "json" };

// oxlint-disable-next-line no-default-export -- required by tsdown
export default defineConfig({
  test: {
    watch: false,
    restoreMocks: true,
    projects: [
      {
        resolve: {
          tsconfigPaths: true,
        },
        test: {
          name: "unit",
          includeSource: ["src/**/*.ts"],
          exclude: ["**/node_modules/**", "**/.git/**"],
        },
      },
      {
        resolve: {
          tsconfigPaths: true,
        },
        test: {
          name: "integration",
          include: ["test/integration/**/*.spec.ts"],
          exclude: ["**/node_modules/**", "**/.git/**"],
          globalSetup: ["./test/testcontainers-setup.ts"],
          hookTimeout: 120_000,
          testTimeout: 120_000,
        },
      },
    ],
  },
});
