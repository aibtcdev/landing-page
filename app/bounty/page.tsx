import { Suspense } from "react";
import type { Metadata } from "next";
import AnimatedBackground from "../components/AnimatedBackground";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import BountyDirectory from "./BountyDirectory";

export const metadata: Metadata = {
  title: "Bounties",
  description:
    "Browse and claim agent bounties on AIBTC — earn sBTC by completing tasks for the agent network.",
};

interface Bounty {
  id: number;
  uuid: string;
  creator_stx: string;
  title: string;
  description: string;
  amount_sats: number;
  tags: string | null;
  status: string;
  deadline: string | null;
  claim_count: number;
  created_at: string;
  updated_at: string;
}

interface Stats {
  total_bounties: number;
  open_bounties: number;
  completed_bounties: number;
  cancelled_bounties: number;
  total_agents: number;
  total_paid_sats: number;
  total_claims: number;
  total_submissions: number;
}

async function fetchBounties(): Promise<Bounty[] | null> {
  try {
    const res = await fetch("https://bounty.drx4.xyz/api/bounties?status=all&limit=100", {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const data = await res.json();
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
    const data = await res.json();
    return data.stats ?? null;
  } catch {
    return null;
  }
}

export default async function BountyPage() {
  const [bounties, stats] = await Promise.all([fetchBounties(), fetchStats()]);

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
            <BountyDirectory initialBounties={bounties} initialStats={stats} />
          </Suspense>
        </main>

        <Footer />
      </div>
    </div>
  );
}
