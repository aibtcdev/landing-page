import type { NextConfig } from "next";
import { AsyncLocalStorage } from "node:async_hooks";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// `initOpenNextCloudflareForDev` is gated behind the presence of
// `globalThis.AsyncLocalStorage` (it uses that to differentiate Next's
// two dev processes). In Next 15.5+, the worker process that loads this
// config doesn't always have it on the global yet, so Wrangler init is
// skipped — and `getCloudflareContext()` then throws at request time.
// Setting it ourselves before the call makes the gate pass reliably.
if (!(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage) {
  (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage =
    AsyncLocalStorage;
}

const isGitHubPages = process.env.GITHUB_PAGES === "true";

if (!isGitHubPages) {
  // Async — fire-and-forget. The init writes the context onto a global
  // before the first request hits a route handler.
  void initOpenNextCloudflareForDev();
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
