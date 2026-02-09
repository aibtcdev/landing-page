import type { Metadata } from "next";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AgentRecord } from "@/lib/types";
import { computeLevel, LEVELS, type ClaimStatus } from "@/lib/levels";
import { generateName } from "@/lib/name-generator";
import AgentProfile from "./AgentProfile";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string }>;
}): Promise<Metadata> {
  const { address } = await params;

  try {
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    const prefix = address.startsWith("SP")
      ? "stx"
      : address.startsWith("bc1")
        ? "btc"
        : null;
    if (!prefix) return { title: "Agent Not Found" };

    const agentData = await kv.get(`${prefix}:${address}`);
    if (!agentData) return { title: "Agent Not Found" };

    const agent = JSON.parse(agentData) as AgentRecord;
    const displayName = agent.displayName || generateName(agent.btcAddress);
    const description =
      agent.description || "Verified AIBTC agent with Bitcoin and Stacks capabilities";

    // Compute level for richer description
    const claimData = await kv.get(`claim:${agent.btcAddress}`);
    let claim: ClaimStatus | null = null;
    if (claimData) {
      try {
        claim = JSON.parse(claimData) as ClaimStatus;
      } catch {
        /* ignore */
      }
    }
    const level = computeLevel(agent, claim);
    const levelName = LEVELS[level].name;

    const ogTitle = `${displayName} — ${levelName} Agent`;
    const ogImage = `/api/og/${agent.btcAddress}`;

    return {
      title: displayName,
      description,
      openGraph: {
        title: ogTitle,
        description,
        type: "profile",
        images: [
          {
            url: ogImage,
            width: 1200,
            height: 630,
            alt: ogTitle,
          },
        ],
      },
      twitter: {
        card: "summary_large_image",
        title: ogTitle,
        description,
        images: [ogImage],
        creator: "@aibtcdev",
        site: "@aibtcdev",
      },
    };
  } catch {
    return { title: "Agent" };
  }
}

export default function AgentProfilePage() {
  return <AgentProfile />;
}
