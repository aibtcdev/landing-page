import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  output: isGitHubPages ? "export" : undefined,
  basePath: isGitHubPages ? "/landing-page" : "",
    async redirects() {
    return [
      {
        source: '/bounties',
        destination: '/bounty',
        permanent: false,
      },
      {
        source: '/bounties/:path*',
        destination: '/bounty/:path*',
        permanent: false,
      }
    ];
  },
  images: {
    unoptimized: isGitHubPages,
  },
  env: {
    NEXT_PUBLIC_BASE_PATH: isGitHubPages ? "/landing-page" : "",
  },
};

export default nextConfig;
