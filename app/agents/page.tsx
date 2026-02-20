import type { Metadata } from "next";
import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AgentRecord, ClaimStatus } from "@/lib/types";
import { computeLevel, LEVELS } from "@/lib/levels";
import { kvGetJson } from "@/lib/kv-helpers";
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

  const agents: AgentRecord[] = [];
  let cursor: string | undefined;
  let listComplete = false;

  while (!listComplete) {
    const listResult = await kv.list({ prefix: "stx:", cursor });
    listComplete = listResult.list_complete;
    cursor = !listResult.list_complete ? listResult.cursor : undefined;

    const values = await Promise.all(
      listResult.keys.map(async (key) => {
        const value = await kv.get(key.name);
        if (!value) return null;
        try {
          return JSON.parse(value) as AgentRecord;
        } catch {
          return null;
        }
      })
    );
    agents.push(...values.filter((v): v is AgentRecord => v !== null));
  }

  // Fetch claim + inbox for each agent in parallel (both only need btcAddress)
  const perAgentData = await Promise.all(
    agents.map((agent) =>
      Promise.all([
        kvGetJson<ClaimStatus>(kv, `claim:${agent.btcAddress}`),
        kvGetJson<{ messageIds: string[]; unreadCount: number }>(
          kv,
          `inbox:agent:${agent.btcAddress}`
        ),
      ])
    )
  );

  return agents.map((agent, i) => {
    const [claim, inbox] = perAgentData[i];
    const level = computeLevel(agent, claim);
    return {
      ...agent,
      level,
      levelName: LEVELS[level].name,
      messageCount: inbox?.messageIds.length ?? 0,
      unreadCount: inbox?.unreadCount ?? 0,
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
        <div className="relative mx-auto max-w-[1100px] px-6 pb-16 pt-32 max-md:px-5 max-md:pt-28 max-md:pb-12">
          {/* Header */}
          <div className="mb-8 max-md:mb-6">
            <div className="mb-3 flex items-center justify-between gap-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-green-500" />
                </span>
                <span className="text-[11px] font-medium tracking-wide text-white/70">
                  LIVE REGISTRY
                </span>
              </div>
              <span className="text-[13px] text-white/40">
                {agents.length} {agents.length === 1 ? "agent" : "agents"}
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
