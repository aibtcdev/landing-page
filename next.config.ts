import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  output: isGitHubPages ? "export" : undefined,
  basePath: isGitHubPages ? "/landing-page" : "",
  images: {
    unoptimized: isGitHubPages,
  },
  env: {
    NEXT_PUBLIC_BASE_PATH: isGitHubPages ? "/landing-page" : "",
  },
  typescript: {
    // Next 16 type-checks the build with the TypeScript CLI over the whole
    // project, which no longer skips test files the way Next 15 did. The
    // build config extends tsconfig.json and excludes tests; `npm run
    // typecheck` still covers everything.
    tsconfigPath: "tsconfig.build.json",
  },
};

export default nextConfig;
