interface CloudflareEnv {
  ASSETS: Fetcher;
  DB: D1Database; // D1 relational database (agents, claims, inbox_messages, vouches, swaps, balances)
  VERIFIED_AGENTS: KVNamespace;
  HOLDINGS_KV?: KVNamespace; // Read-only agent L2 (sBTC) balances, populated by the aibtc-dashboard holdings scanner (key `holdings:all`)
  RATE_LIMIT_READ: RateLimit;
  RATE_LIMIT_MUTATING: RateLimit;
  RATE_LIMIT_AUTHENTICATED: RateLimit;
  RATE_LIMIT_STRICT: RateLimit;
  RATE_LIMIT_CHECKIN: RateLimit;
  RATE_LIMIT_RELAY_FAILURES: RateLimit;
  DEPLOY_ENV?: "production" | "preview"; // Set via wrangler vars per env; undefined in local dev → fail-open
  ARC_ADMIN_API_KEY: string; // Admin API key for /api/admin/* endpoints
  HIRO_API_KEY?: string; // Hiro API key for authenticated Stacks API requests (set via wrangler secret)
  UNISAT_API_KEY?: string; // Unisat API key for Ordinals indexer requests (set via wrangler secret)
  GITHUB_TOKEN?: string; // GitHub personal access token for authenticated API requests (raises rate limit from 60 to 5000 req/hr)
  LOGS?: unknown; // Worker-logs RPC service binding (type guarded via isLogsRPC)
  DEPLOY_SHA?: string; // Optional deploy/build SHA for structured observability
  CF_PAGES_COMMIT_SHA?: string; // Pages-provided commit SHA when available
  X402_NETWORK?: "mainnet" | "testnet"; // Stacks network for x402 verification
  X402_RELAY_URL?: string; // x402 relay URL for all payment settlement (default: https://x402-relay.aibtc.com)
  X402_RELAY?: import("./lib/inbox/relay-rpc").RelayRPC; // x402 sponsor relay RPC service binding (undefined in local dev)
  INBOX_RECONCILIATION_QUEUE?: Queue<import("./lib/inbox/reconciliation-queue").InboxReconciliationQueueMessage>;
  // Inline stub interface (not `import("./worker").SchedulerDO`) so this
  // d.ts doesn't pull worker.ts into Next.js's type-check pass, where
  // `./.open-next/worker.js` doesn't resolve until after OpenNext runs.
  //
  // The `Rpc.DurableObjectBranded` intersection is load-bearing:
  // `DurableObjectNamespace<T>` requires T to extend that brand for the
  // stub returned from `.get(id)` to surface T's RPC methods (per
  // @cloudflare/workers-types — DurableObjectStub<T> = Fetcher<T> which
  // only expands T's methods when T is branded). Without it, callers
  // see `.fetch()` / `.connect()` only, never `.status()` / etc.
  //
  // Keep these method signatures in sync with SchedulerRpc in
  // lib/scheduler/rpc-types.ts and SchedulerDO in worker.ts.
  SCHEDULER?: DurableObjectNamespace<
    Rpc.DurableObjectBranded & import("./lib/scheduler/rpc-types").SchedulerRpc
  >;
  TENERO_REFRESH_ENABLED?: "true"; // Explicit production-only gate for SchedulerDO Tenero refreshes
  TENERO_API_KEY?: string; // Optional Tenero API key (x-api-key header); raises rate limits above the shared web-ui-ip tier
}
