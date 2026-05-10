import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AgentRecord, ClaimRecord } from "@/lib/types";
import { getAgentLevel, computeLevel, LEVELS } from "@/lib/levels";
import { generateName } from "@/lib/name-generator";
import { lookupOwnerByBnsName } from "@/lib/bns";
import { X_HANDLE } from "@/lib/constants";
import { stacksApiFetch, buildHiroHeaders } from "@/lib/stacks-api-fetch";
import { STACKS_API_BASE, IDENTITY_REGISTRY_CONTRACT } from "@/lib/identity/constants";
import {
  getCachedIdentity,
  setCachedIdentity,
  setCachedIdentityNegative,
  setCachedIdentityLookupFailed,
} from "@/lib/identity/kv-cache";
import type { AgentIdentity } from "@/lib/identity/types";
import { getAgentsIndex } from "@/lib/agents-index";
import {
  lookupBtcAddressByBnsName,
  syncBnsLookup,
} from "@/lib/bns-reverse-index";
import {
  classifyAddress,
  lookupProfileByBtcAddress,
  lookupProfileByStxAddress,
  lookupProfileByAgentId,
  mapRowToAgentRecord,
  mapRowToClaimRecord,
} from "@/lib/cache/agent-profile";
import AgentProfile from "./AgentProfile";
import Navbar from "../../components/Navbar";
import AnimatedBackground from "../../components/AnimatedBackground";


/**
 * Resolve an agent + claim from D1 by any supported address shape.
 *
 * Phase 2.2: replaces KV lookupAgent() + KV claim fetch with a single D1
 * SELECT + LEFT JOIN claims. Taproot and BNS still use KV for the reverse-lookup
 * step (those KV keys are not being migrated in Phase 2.2).
 *
 * Returns { agent, claim } or null if not found.
 */
async function resolveAgentAndClaim(
  db: D1Database,
  kv: KVNamespace,
  address: string,
  hiroApiKey?: string
): Promise<{ agent: AgentRecord; claim: ClaimRecord | null } | null> {
  const branch = classifyAddress(address);
  if (!branch) return null;

  let agent: AgentRecord | null = null;
  let claim: ClaimRecord | null = null;

  if (branch === "btc") {
    const row = await lookupProfileByBtcAddress(db, address);
    if (row) {
      agent = mapRowToAgentRecord(row);
      claim = mapRowToClaimRecord(row);
    }
  } else if (branch === "stx") {
    const row = await lookupProfileByStxAddress(db, address);
    if (row) {
      agent = mapRowToAgentRecord(row);
      claim = mapRowToClaimRecord(row);
    }
  } else if (branch === "numeric") {
    const agentId = parseInt(address, 10);
    if (!Number.isNaN(agentId)) {
      const row = await lookupProfileByAgentId(db, agentId);
      if (row) {
        agent = mapRowToAgentRecord(row);
        claim = mapRowToClaimRecord(row);
      }
    }
  } else if (branch === "taproot") {
    // KV reverse-lookup for taproot (not migrated in Phase 2.2), then D1
    const canonicalBtcAddress = await kv.get(`taproot:${address}`);
    if (canonicalBtcAddress) {
      const row = await lookupProfileByBtcAddress(db, canonicalBtcAddress);
      if (row) {
        agent = mapRowToAgentRecord(row);
        claim = mapRowToClaimRecord(row);
      }
    }
  } else {
    // BNS name: KV reverse-index fast path, then fallback to agents:index,
    // then Hiro BNS API as last resort. Only final agent record fetch uses D1.
    const target = address.toLowerCase();
    let btcAddress = await lookupBtcAddressByBnsName(kv, target);
    if (!btcAddress) {
      const index = await getAgentsIndex(kv);
      const entry = index.agents.find(
        (a) => a.bnsName && a.bnsName.toLowerCase() === target,
      );
      if (entry) {
        btcAddress = entry.btcAddress;
        void syncBnsLookup(kv, null, target, btcAddress);
      }
    }

    if (btcAddress) {
      const row = await lookupProfileByBtcAddress(db, btcAddress);
      if (row && row.bns_name && row.bns_name.toLowerCase() === target) {
        agent = mapRowToAgentRecord(row);
        claim = mapRowToClaimRecord(row);
      }
    }

    // Last resort: Hiro BNS API.
    // lookupOwnerByBnsName resolves BNS name → owner STX address (reverse lookup).
    // lookupBnsName would be wrong here: it resolves STX address → BNS name (forward).
    if (!agent) {
      const resolvedStx = await lookupOwnerByBnsName(target, hiroApiKey, kv).catch(() => null);
      if (resolvedStx) {
        const row = await lookupProfileByStxAddress(db, resolvedStx);
        if (row) {
          agent = mapRowToAgentRecord(row);
          claim = mapRowToClaimRecord(row);
        }
      }
    }
  }

  if (!agent) return null;
  return { agent, claim };
}

/**
 * Detect and cache the on-chain ERC-8004 identity for an agent.
 */
async function resolveIdentity(
  kv: KVNamespace,
  agent: AgentRecord,
  hiroApiKey?: string
): Promise<AgentRecord> {
  // Positive result already on the agent record — skip cache + Hiro
  if (agent.erc8004AgentId != null) return agent;

  // Check typed identity cache (covers both positive and negative sentinels)
  const cached = await getCachedIdentity(agent.stxAddress, kv);
  if (cached.hit) {
    if (cached.value) {
      agent.erc8004AgentId = cached.value.agentId;
    }
    return agent;
  }

  // Cache miss — fetch from Hiro through the keyed wrapper
  try {
    const [contractAddress, contractName] = IDENTITY_REGISTRY_CONTRACT.split(".");
    const assetId = `${contractAddress}.${contractName}::agent-identity`;
    const url = `${STACKS_API_BASE}/extended/v1/tokens/nft/holdings?principal=${agent.stxAddress}&asset_identifiers=${encodeURIComponent(assetId)}&limit=1`;

    const resp = await stacksApiFetch(
      url,
      { headers: buildHiroHeaders(hiroApiKey) },
      { retries: 2, retries429: 1 }
    );
    if (!resp.ok) {
      await setCachedIdentityLookupFailed(agent.stxAddress, kv);
      return agent;
    }

    const data = await resp.json() as {
      results?: Array<{ value: { repr: string } }>;
    };

    const repr = data.results?.[0]?.value?.repr;
    const match = repr?.match(/^u(\d+)$/);
    const newAgentId = match ? Number(match[1]) : null;

    if (newAgentId != null) {
      agent.erc8004AgentId = newAgentId;
      const updated = JSON.stringify(agent);
      const identity: AgentIdentity = { agentId: newAgentId, owner: agent.stxAddress, uri: "" };
      await Promise.all([
        kv.put(`stx:${agent.stxAddress}`, updated),
        kv.put(`btc:${agent.btcAddress}`, updated),
        setCachedIdentity(agent.stxAddress, identity, kv),
      ]);
    } else {
      await setCachedIdentityNegative(agent.stxAddress, kv);
    }
  } catch {
    await setCachedIdentityLookupFailed(agent.stxAddress, kv);
  }

  return agent;
}

/**
 * Cached wrappers so generateMetadata() and AgentProfilePage() share
 * the same D1 reads within a single request.
 */
const cachedResolveAgentAndClaim = cache(async (address: string) => {
  const { env } = await getCloudflareContext();
  const kv = env.VERIFIED_AGENTS as KVNamespace;
  const db = env.DB as D1Database;
  return resolveAgentAndClaim(db, kv, address, env.HIRO_API_KEY);
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string }>;
}): Promise<Metadata> {
  const { address } = await params;

  try {
    const result = await cachedResolveAgentAndClaim(address);
    if (!result) return { title: "Agent Not Found" };

    const { agent, claim: claimRecord } = result;
    const displayName = agent.displayName || generateName(agent.btcAddress);
    const description =
      agent.description ||
      "Verified AIBTC agent with Bitcoin and Stacks capabilities";

    const claimStatus = claimRecord
      ? { status: claimRecord.status, claimedAt: claimRecord.claimedAt, rewardSatoshis: claimRecord.rewardSatoshis }
      : null;
    const level = computeLevel(agent, claimStatus);
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
        creator: X_HANDLE,
        site: X_HANDLE,
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
    const result = await cachedResolveAgentAndClaim(address);

    if (!result) {
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

    const { agent, claim: claimRecord } = result;

    // Resolve identity (cached KV + Hiro)
    const agentWithIdentity = await resolveIdentity(kv, agent, env.HIRO_API_KEY);

    // Compute level info
    const claimStatus = claimRecord
      ? {
          status: claimRecord.status,
          claimedAt: claimRecord.claimedAt,
          rewardSatoshis: claimRecord.rewardSatoshis,
        }
      : null;

    const levelInfo = getAgentLevel(agentWithIdentity, claimStatus);

    // Build claim info for the client (matching the ClaimInfo shape expected by AgentProfile)
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
