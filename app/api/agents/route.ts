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

      for (const key of listResult.keys) {
        const value = await kv.get(key.name);
        if (value) {
          try {
            agents.push(JSON.parse(value));
          } catch (e) {
            console.error(`Failed to parse agent record ${key.name}:`, e);
            // Skip corrupted entries
          }
        }
      }
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
