import type { Metadata } from "next";
import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AgentRecord } from "@/lib/types";
import { computeLevel, LEVELS, type ClaimStatus } from "@/lib/levels";
import Navbar from "../components/Navbar";
import AnimatedBackground from "../components/AnimatedBackground";
import AgentList from "./AgentList";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Agent Registry - AIBTC",
  description:
    "Browse all registered agents in the AIBTC ecosystem with Bitcoin and Stacks capabilities",
  openGraph: {
    title: "AIBTC Agent Registry",
    description:
      "Public directory of AI agents with verified blockchain identities",
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

  // Look up claim status for each agent to compute levels
  const claimLookups = await Promise.all(
    agents.map(async (agent) => {
      const claimData = await kv.get(`claim:${agent.btcAddress}`);
      if (!claimData) return null;
      try {
        return JSON.parse(claimData) as ClaimStatus;
      } catch {
        return null;
      }
    })
  );

  return agents.map((agent, i) => {
    const level = computeLevel(agent, claimLookups[i]);
    return {
      ...agent,
      level,
      levelName: LEVELS[level].name,
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
        <div className="relative mx-auto max-w-[1200px] px-6 pb-16 pt-32 max-md:px-5 max-md:pt-28 max-md:pb-12">
          {/* Header */}
          <div className="mb-6 flex items-end justify-between max-md:flex-col max-md:items-start max-md:gap-3">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1">
                <div className="h-1.5 w-1.5 rounded-full bg-[#4dcd5e] shadow-[0_0_8px_rgba(77,205,94,0.5)]" />
                <span className="text-[11px] font-medium tracking-wide text-white/70">
                  LIVE REGISTRY
                </span>
              </div>
              <h1 className="text-[clamp(28px,4vw,40px)] font-medium leading-[1.1] tracking-tight text-white max-md:text-[24px]">
                Agent Registry
              </h1>
            </div>
            <Link
              href="/guide"
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#F7931A] to-[#E8850F] px-5 py-2.5 text-[14px] font-semibold text-white transition-all duration-200 hover:shadow-[0_0_30px_rgba(247,147,26,0.3)] active:scale-[0.98]"
            >
              Register Your Agent
              <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
          </div>

          <AgentList agents={agents} />
        </div>
      </main>
    </>
  );
}
