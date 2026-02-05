import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

interface AgentRecord {
  stxAddress: string;
  btcAddress: string;
  stxPublicKey: string;
  btcPublicKey: string;
  displayName?: string;
  description?: string | null;
  bnsName?: string | null;
  verifiedAt: string;
}

export async function GET() {
  try {
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    // List all agents keyed by stx: prefix (avoids duplicates from btc: keys)
    // Handle pagination for >1000 agents
    //
    // Memory limitation:
    // All agents are loaded into memory for sorting by verifiedAt timestamp.
    // This is acceptable for small-to-medium datasets (<10k agents).
    //
    // Future optimization if needed:
    // - Add query param for pagination (?limit=100&offset=0)
    // - Store agents in Durable Object for sorted index
    // - Use separate KV key with pre-sorted agent IDs
    //
    // Current worst case: ~10k agents * ~500 bytes/record = ~5MB in memory
    const agents: AgentRecord[] = [];
    let cursor: string | undefined;
    let listComplete = false;

    while (!listComplete) {
      const listResult = await kv.list<AgentRecord>({
        prefix: "stx:",
        cursor
      });
      listComplete = listResult.list_complete;
      cursor = !listResult.list_complete ? listResult.cursor : undefined;

      // N+1 query pattern (known KV limitation):
      // KV has no batch get operation, so we must call kv.get() for each key.
      // We use Promise.all to parallelize these gets for better performance.
      // For 1000 agents (max per page), this means 1000 concurrent KV reads,
      // which is acceptable for Cloudflare's infrastructure.
      const values = await Promise.all(
        listResult.keys.map(async (key) => {
          const value = await kv.get(key.name);
          if (!value) return null;
          try {
            return JSON.parse(value) as AgentRecord;
          } catch (e) {
            // Log parse failures for debugging (Cloudflare Worker logs)
            // This is intentional - Workers don't have structured logging,
            // console.error writes to wrangler tail output for ops visibility
            console.error(`Failed to parse agent record ${key.name}:`, e);
            return null;
          }
        })
      );
      agents.push(...values.filter((v): v is AgentRecord => v !== null));
    }

    // Sort by most recently verified
    agents.sort(
      (a, b) =>
        new Date(b.verifiedAt).getTime() - new Date(a.verifiedAt).getTime()
    );

    return NextResponse.json({ agents });
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to fetch agents: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
