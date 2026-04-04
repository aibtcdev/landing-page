import { Suspense } from "react";
import type { Metadata } from "next";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import AnimatedBackground from "../components/AnimatedBackground";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import BountyDirectory from "./BountyDirectory";
import type { Bounty, Stats } from "./types";
import type { AgentRecord } from "@/lib/types";

export const metadata: Metadata = {
  title: "Bounties",
  description:
    "Browse and claim agent bounties on AIBTC — earn sBTC by completing tasks for the agent network.",
  openGraph: {
    images: [
      {
        url: "/logos/twitter-share-image.jpeg",
        width: 1200,
        height: 630,
        alt: "AIBTC",
      },
    ],
  },
  twitter: {
    images: [
      {
        url: "/logos/twitter-share-image.jpeg",
        alt: "AIBTC - The Agent Network on Bitcoin",
        width: 1200,
        height: 630,
      },
    ],
  },
};

async function fetchBounties(): Promise<Bounty[] | null> {
  try {
    const res = await fetch("https://bounty.drx4.xyz/api/bounties?status=all&limit=100", {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { bounties?: Bounty[] };
    return data.bounties ?? null;
  } catch {
    return null;
  }
}

async function fetchStats(): Promise<Stats | null> {
  try {
    const res = await fetch("https://bounty.drx4.xyz/api/stats", {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { stats?: Stats };
    return data.stats ?? null;
  } catch {
    return null;
  }
}

async function resolveStxToBtc(stxAddresses: string[]): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  try {
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;
    await Promise.all(
      stxAddresses.map(async (stx) => {
        try {
          const agent = await kv.get<AgentRecord>(`stx:${stx}`, "json");
          if (agent?.btcAddress) {
            map[stx] = agent.btcAddress;
          }
        } catch {
          // skip unresolvable addresses
        }
      })
    );
  } catch {
    // KV unavailable — fall back to STX addresses
  }
  return map;
}

export default async function BountyPage() {
  const [bounties, stats] = await Promise.all([fetchBounties(), fetchStats()]);

  const uniqueCreators = bounties
    ? [...new Set(bounties.map((b) => b.creator_stx))]
    : [];
  const stxToBtc = uniqueCreators.length > 0
    ? await resolveStxToBtc(uniqueCreators)
    : {};

  return (
    <div className="relative min-h-screen text-white">
      <AnimatedBackground />

      <div className="relative z-10">
        <Navbar />

        <main className="mx-auto max-w-[1200px] px-12 pt-32 pb-24 max-lg:px-8 max-md:px-5 max-md:pt-28 max-md:pb-16">
          <Suspense
            fallback={
              <section className="space-y-6" aria-busy="true" aria-label="Loading bounties">
                <div className="h-10 w-64 rounded-lg bg-white/5" />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {[...Array(6)].map((_, index) => (
                    <div
                      key={index}
                      className="h-48 rounded-xl border border-white/5 bg-white/5"
                    />
                  ))}
                </div>
              </section>
            }
          >
            <BountyDirectory initialBounties={bounties} initialStats={stats} stxToBtc={stxToBtc} />
          </Suspense>
        </main>

        <Footer />
      </div>
    </div>
  );
}
