interface CloudflareEnv {
  ASSETS: Fetcher;
  VERIFIED_AGENTS: KVNamespace;
  ARC_ADMIN_API_KEY: string; // Admin API key for /api/admin/* endpoints
}
