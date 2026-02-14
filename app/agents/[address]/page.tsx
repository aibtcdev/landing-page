import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AgentRecord } from "@/lib/types";
import { lookupAgent } from "@/lib/agent-lookup";
import { getAgentLevel, computeLevel, LEVELS, type ClaimStatus } from "@/lib/levels";
import { generateName } from "@/lib/name-generator";
import { lookupBnsName } from "@/lib/bns";
import { detectAgentIdentity } from "@/lib/identity/detection";
import { IDENTITY_CHECK_TTL_MS } from "@/lib/identity/constants";
import { TWITTER_HANDLE } from "@/lib/constants";
import AgentProfile from "./AgentProfile";
import Navbar from "../../components/Navbar";
import AnimatedBackground from "../../components/AnimatedBackground";

/** Claim record shape stored in KV at `claim:{btcAddress}` */
interface ClaimRecord {
  btcAddress: string;
  displayName: string;
  tweetUrl: string;
  tweetAuthor: string | null;
  claimedAt: string;
  rewardSatoshis: number;
  rewardTxid: string | null;
  status: "pending" | "verified" | "rewarded" | "failed";
}


/**
 * Resolve an agent from KV by BTC address, STX address, or BNS name.
 * Also performs a lazy BNS refresh if the agent is missing a BNS name.
 */
async function resolveAgent(
  kv: KVNamespace,
  address: string
): Promise<AgentRecord | null> {
  // Direct lookup by BTC or STX
  let agent = await lookupAgent(kv, address);

  // If not found and looks like a BNS name, scan for it
  if (!agent && address.endsWith(".btc")) {
    // Scan all agents looking for matching bnsName
    let cursor: string | undefined;
    let listComplete = false;
    while (!listComplete && !agent) {
      const listResult = await kv.list({ prefix: "stx:", cursor });
      listComplete = listResult.list_complete;
      cursor = !listResult.list_complete ? listResult.cursor : undefined;
      const values = await Promise.all(
        listResult.keys.map((key) => kv.get(key.name))
      );
      for (let i = 0; i < listResult.keys.length; i++) {
        const value = values[i];
        if (!value) continue;
        try {
          const record = JSON.parse(value) as AgentRecord;
          if (
            record.bnsName &&
            record.bnsName.toLowerCase() === address.toLowerCase()
          ) {
            agent = record;
            break;
          }
        } catch {
          /* ignore */
        }
      }
    }
  }

  if (!agent) return null;

  // Lazy BNS refresh (blocks this request but acceptable for correctness)
  if (!agent.bnsName && agent.stxAddress) {
    try {
      const bnsName = await lookupBnsName(agent.stxAddress);
      if (bnsName) {
        agent.bnsName = bnsName;
        const updated = JSON.stringify(agent);
        await Promise.all([
          kv.put(`stx:${agent.stxAddress}`, updated),
          kv.put(`btc:${agent.btcAddress}`, updated),
        ]);
      }
    } catch {
      /* ignore BNS lookup failures */
    }
  }

  return agent;
}

/**
 * Detect and cache the on-chain ERC-8004 identity for an agent.
 * Reuses the same TTL-based caching logic as /api/identity/[address].
 */
async function resolveIdentity(
  kv: KVNamespace,
  agent: AgentRecord
): Promise<AgentRecord> {
  // Cache check: skip scan if checked recently (positive or negative)
  const isCheckedRecently =
    agent.lastIdentityCheck &&
    Date.now() - new Date(agent.lastIdentityCheck).getTime() < IDENTITY_CHECK_TTL_MS;

  if (isCheckedRecently && agent.erc8004AgentId !== undefined) {
    return agent;
  }

  // Run the O(N) identity scan server-side
  try {
    const identity = await detectAgentIdentity(agent.stxAddress);
    agent.erc8004AgentId = identity ? identity.agentId : null;
    agent.lastIdentityCheck = new Date().toISOString();
    const updated = JSON.stringify(agent);
    await Promise.all([
      kv.put(`stx:${agent.stxAddress}`, updated),
      kv.put(`btc:${agent.btcAddress}`, updated),
    ]);
  } catch {
    /* identity detection is best-effort */
  }

  return agent;
}

/**
 * Fetch claim record from KV.
 */
async function fetchClaim(
  kv: KVNamespace,
  btcAddress: string
): Promise<ClaimRecord | null> {
  const claimData = await kv.get(`claim:${btcAddress}`);
  if (!claimData) return null;
  try {
    return JSON.parse(claimData) as ClaimRecord;
  } catch {
    return null;
  }
}

/**
 * Cached wrappers so generateMetadata() and AgentProfilePage() share
 * the same KV reads within a single request.
 */
const cachedResolveAgent = cache(async (address: string) => {
  const { env } = await getCloudflareContext();
  const kv = env.VERIFIED_AGENTS as KVNamespace;
  return resolveAgent(kv, address);
});

const cachedFetchClaim = cache(async (btcAddress: string) => {
  const { env } = await getCloudflareContext();
  const kv = env.VERIFIED_AGENTS as KVNamespace;
  return fetchClaim(kv, btcAddress);
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string }>;
}): Promise<Metadata> {
  const { address } = await params;

  try {
    const agent = await cachedResolveAgent(address);
    if (!agent) return { title: "Agent Not Found" };

    const displayName = agent.displayName || generateName(agent.btcAddress);
    const description =
      agent.description ||
      "Verified AIBTC agent with Bitcoin and Stacks capabilities";

    const claimRecord = await cachedFetchClaim(agent.btcAddress);
    const claim: ClaimStatus | null = claimRecord
      ? { status: claimRecord.status, claimedAt: claimRecord.claimedAt, rewardSatoshis: claimRecord.rewardSatoshis }
      : null;
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
        creator: TWITTER_HANDLE,
        site: TWITTER_HANDLE,
      },
    };
  } catch {
    return { title: "Agent" };
  }
}

export default async function AgentProfilePage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;

  try {
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    // Use cached resolver (shared with generateMetadata)
    const agent = await cachedResolveAgent(address);

    if (!agent) {
      return (
        <>
          <AnimatedBackground />
          <Navbar />
          <div className="flex min-h-[90vh] flex-col items-center justify-center gap-3 pt-24">
            <p className="text-sm text-white/40">
              This address is not registered
            </p>
            <Link
              href="/guide"
              className="text-xs text-[#F7931A]/70 hover:text-[#F7931A] transition-colors"
            >
              Register your agent →
            </Link>
            <Link
              href="/agents"
              className="text-xs text-white/40 hover:text-white/70 transition-colors"
            >
              ← Back to Registry
            </Link>
          </div>
        </>
      );
    }

    // Fetch claim (cached, shared with generateMetadata) and identity in parallel
    const [claimRecord, agentWithIdentity] = await Promise.all([
      cachedFetchClaim(agent.btcAddress),
      resolveIdentity(kv, agent),
    ]);

    // Compute level info
    const claimStatus: ClaimStatus | null =
      claimRecord
        ? {
            status: claimRecord.status,
            claimedAt: claimRecord.claimedAt,
            rewardSatoshis: claimRecord.rewardSatoshis,
          }
        : null;

    const levelInfo = getAgentLevel(agentWithIdentity, claimStatus);

    // Build claim info for the client (matching the ClaimInfo shape)
    const claimInfo = claimRecord
      ? {
          status: claimRecord.status,
          rewardSatoshis: claimRecord.rewardSatoshis,
          rewardTxid: claimRecord.rewardTxid,
          tweetUrl: claimRecord.tweetUrl,
          tweetAuthor: claimRecord.tweetAuthor,
          claimedAt: claimRecord.claimedAt,
        }
      : null;

    return (
      <AgentProfile
        agent={agentWithIdentity}
        claim={claimInfo}
        level={levelInfo.level}
        levelName={levelInfo.levelName}
        nextLevel={levelInfo.nextLevel}
      />
    );
  } catch {
    // Fallback error state
    return (
      <>
        <AnimatedBackground />
        <Navbar />
        <div className="flex min-h-[90vh] flex-col items-center justify-center gap-3 pt-24">
          <p className="text-sm text-white/40">
            This address is not registered
          </p>
          <Link
            href="/guide"
            className="text-xs text-[#F7931A]/70 hover:text-[#F7931A] transition-colors"
          >
            Register your agent →
          </Link>
          <Link
            href="/agents"
            className="text-xs text-white/40 hover:text-white/70 transition-colors"
          >
            ← Back to Registry
          </Link>
        </div>
      </>
    );
  }
}
