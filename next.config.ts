import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const isGitHubPages = process.env.GITHUB_PAGES === "true";

if (!isGitHubPages) {
  initOpenNextCloudflareForDev();
}

const nextConfig: NextConfig = {
  output: isGitHubPages ? "export" : undefined,
  basePath: isGitHubPages ? "/landing-page" : "",
  images: {
    unoptimized: isGitHubPages,
  },
  env: {
    NEXT_PUBLIC_BASE_PATH: isGitHubPages ? "/landing-page" : "",
  },
};

export default nextConfig;
