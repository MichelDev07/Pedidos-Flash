import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(rootDir, "./src");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode || "test", rootDir, "");

  return {
    resolve: {
      alias: {
        "@": srcDir,
      },
    },
    test: {
      env,
      projects: [
        {
          extends: true,
          test: {
            name: "unit",
            environment: "node",
            include: ["tests/unit/**/*.test.ts"],
            testTimeout: 10_000,
          },
        },
        {
          extends: true,
          test: {
            name: "integration",
            environment: "node",
            include: ["tests/integration/**/*.test.ts"],
            fileParallelism: false,
            sequence: {
              concurrent: false,
            },
            testTimeout: 30_000,
            hookTimeout: 30_000,
          },
        },
      ],
    },
  };
});
