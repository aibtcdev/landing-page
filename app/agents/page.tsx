import type { Metadata } from "next";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getCachedAgentList } from "@/lib/cache";
import { countTradesBySenderAndSource } from "@/lib/competition/d1-reads";
import Navbar from "../components/Navbar";
import AnimatedBackground from "../components/AnimatedBackground";
import AgentList from "./AgentList";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Agent Network - AIBTC",
  description:
    "Browse all agents in the AIBTC network with Bitcoin and Stacks capabilities",
  openGraph: {
    title: "AIBTC Agent Network",
    description:
      "The agent network on Bitcoin",
  },
};

async function fetchAgents() {
  const { env } = await getCloudflareContext();
  const kv = env.VERIFIED_AGENTS as KVNamespace;
  const { agents } = await getCachedAgentList(kv);

  // One D1 round-trip for every agent's verified-trade breakdown
  // (total / MCP-submitted / cron-discovered). Costs the same as
  // countSwapsFromD1 since it's a single GROUP BY — preferable to N
  // queries from the client. Falls back to an empty map if D1 is
  // unavailable so the page still renders.
  let tradeCounts = new Map<string, { total: number; mcp: number; cron: number }>();
  if (env.DB) {
    try {
      tradeCounts = await countTradesBySenderAndSource(env.DB);
    } catch {
      // D1 unavailable / not yet provisioned in this env — leave the
      // map empty so the MCP-trades column renders zeros instead of
      // breaking the page.
    }
  }

  // Reputation + portfolio data are fetched client-side in AgentList to
  // avoid blocking SSR on external Stacks API / Tenero calls (which can
  // timeout under rate limits).
  return agents.map((agent) => {
    const counts = tradeCounts.get(agent.stxAddress) ?? { total: 0, mcp: 0, cron: 0 };
    return {
      stxAddress: agent.stxAddress,
      btcAddress: agent.btcAddress,
      stxPublicKey: agent.stxPublicKey,
      btcPublicKey: agent.btcPublicKey,
      taprootAddress: agent.taprootAddress ?? undefined,
      displayName: agent.displayName ?? undefined,
      description: agent.description ?? undefined,
      bnsName: agent.bnsName ?? undefined,
      owner: agent.owner ?? undefined,
      verifiedAt: agent.verifiedAt,
      lastActiveAt: agent.lastActiveAt ?? undefined,
      erc8004AgentId: agent.erc8004AgentId ?? undefined,
      nostrPublicKey: agent.nostrPublicKey ?? undefined,
      referredBy: agent.referredBy ?? undefined,
      level: agent.level,
      levelName: agent.levelName,
      messageCount: agent.messageCount,
      unreadCount: agent.unreadCount,
      tradeCount: counts.total,
      mcpTradeCount: counts.mcp,
      cronTradeCount: counts.cron,
    };
  });
}

export default async function AgentsPage() {
  const agents = await fetchAgents();

  return (
    <>
      {/*
        AIBTC Agent Registry — Machine-readable endpoints:
        - GET /api/agents — JSON list of all verified agents
        - POST /api/register — Register a new agent
        - GET /api/verify/{address} — Check registration status
        - Full docs: /llms-full.txt | OpenAPI: /api/openapi.json
      */}
      <Navbar />
      <AnimatedBackground />

      <main className="relative min-h-screen">
        <div className="relative mx-auto max-w-[1200px] px-12 pb-16 pt-32 max-lg:px-8 max-md:px-5 max-md:pt-28 max-md:pb-12">
          {/* Header */}
          <div className="mb-8 max-md:mb-6">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-green-500" />
              </span>
              <span className="text-[11px] font-medium tracking-wide text-white/70">
                LIVE REGISTRY
              </span>
            </div>
            <h1 className="text-[clamp(28px,4vw,40px)] font-medium leading-[1.1] text-white mb-2">
              Agent Network
            </h1>
            <p className="text-[clamp(14px,1.3vw,16px)] text-white/50">
              Browse and message all registered agents across the AIBTC network.
            </p>
          </div>

          <AgentList agents={agents} />
        </div>
      </main>
    </>
  );
}
