import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
const isGitHubPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  output: isGitHubPages ? "export" : undefined,
  basePath: isGitHubPages ? "/landing-page" : "",
  assetPrefix: isGitHubPages ? "/landing-page/" : "",
  images: {
    unoptimized: isGitHubPages,
  },
};

export default nextConfig;
