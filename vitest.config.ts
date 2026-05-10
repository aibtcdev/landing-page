import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  esbuild: {
    // Use the automatic JSX runtime so .tsx route files can be imported in
    // tests without needing an explicit `import React from "react"`.
    // Next.js uses the automatic runtime by default; vitest's esbuild must
    // match so imported .tsx files (e.g. app/api/og/[address]/route.tsx) don't
    // throw "React is not defined" when their JSX expressions are evaluated.
    jsx: "automatic",
    jsxImportSource: "react",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    include: ["**/__tests__/**/*.test.ts"],
  },
});
