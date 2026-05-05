import type { NextConfig } from "next";
import { AsyncLocalStorage } from "node:async_hooks";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const isGitHubPages = process.env.GITHUB_PAGES === "true";

// Only initialize Cloudflare context for `next dev`. Skipping for lint and
// build is important: in CI those run unauthenticated, and the init tries
// to start a Wrangler remote-proxy session that requires `wrangler login`.
//
// Detection: NEXT_PHASE === "phase-development-server" is set by Next.js
// when starting the dev server. It's absent during lint/build.
const isDevServer =
  process.env.NEXT_PHASE === "phase-development-server" ||
  // Fallback: NEXT_PHASE may be unset on some launchers; fall back to the
  // canonical npm script. NODE_ENV alone is unreliable (it's "development"
  // for `next lint` too).
  process.env.npm_lifecycle_event === "dev";

if (isDevServer && !isGitHubPages) {
  // `initOpenNextCloudflareForDev` is gated on `globalThis.AsyncLocalStorage`
  // (its way of detecting which of Next.js's two dev processes is the
  // request-handling one). On Next 15.5 the process loading this config
  // doesn't always have it on the global yet, so set it ourselves.
  if (!(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage) {
    (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage =
      AsyncLocalStorage;
  }
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
