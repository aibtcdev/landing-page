interface CloudflareEnv {
  ASSETS: Fetcher;
  VERIFIED_AGENTS: KVNamespace;
  ARC_ADMIN_API_KEY: string; // Admin API key for /api/admin/* endpoints
  HIRO_API_KEY?: string; // Hiro API key for authenticated Stacks API requests (set via wrangler secret)
  LOGS?: unknown; // Worker-logs RPC service binding (type guarded via isLogsRPC)
  X402_FACILITATOR_URL?: string; // x402 payment facilitator URL (e.g., https://facilitator.stacksx402.com)
  X402_NETWORK?: "mainnet" | "testnet"; // Stacks network for x402 verification
  X402_SPONSOR_RELAY_URL?: string; // x402 sponsor relay URL for sponsored transactions
}
