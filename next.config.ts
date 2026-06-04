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
  webpack: (config) => {
    // @stacks/connect pulls in WalletConnect, whose pino logger optionally
    // requires pino-pretty (dev-only pretty printing, never used in prod).
    // Silence the benign "can't resolve pino-pretty" build warning.
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      { module: /node_modules\/pino/, message: /pino-pretty/ },
    ];
    return config;
  },
};

export default nextConfig;
