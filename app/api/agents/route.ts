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
    const list = await kv.list({ prefix: "stx:" });

    const agents: AgentRecord[] = [];
    for (const key of list.keys) {
      const value = await kv.get(key.name);
      if (value) {
        agents.push(JSON.parse(value));
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
