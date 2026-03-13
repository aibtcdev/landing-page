import { cache } from "react";
import type { Metadata } from "next";
import AnimatedBackground from "../../components/AnimatedBackground";
import Navbar from "../../components/Navbar";
import Footer from "../../components/Footer";
import BountyDetail from "./BountyDetail";
import type { BountyData } from "../types";

interface PageProps {
  params: Promise<{ id: string }>;
}

const fetchBountyDetail = cache(async function fetchBountyDetail(
  id: string
): Promise<BountyData | null> {
  try {
    const res = await fetch(`https://bounty.drx4.xyz/api/bounties/${id}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return (await res.json()) as BountyData;
  } catch {
    return null;
  }
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  try {
    const data = await fetchBountyDetail(id);
    if (data) {
      const bounty = data.bounty;
      return {
        title: bounty?.title ?? "Bounty",
        description: bounty?.description?.slice(0, 160) ?? "View bounty details on AIBTC",
      };
    }
  } catch {
    // fall through
  }
  return {
    title: "Bounty",
    description: "View bounty details on AIBTC",
  };
}

export default async function BountyDetailPage({ params }: PageProps) {
  const { id } = await params;
  const data = await fetchBountyDetail(id);

  return (
    <div className="relative min-h-screen text-white">
      <AnimatedBackground />

      <div className="relative z-10">
        <Navbar />

        <main className="mx-auto max-w-[1200px] px-12 pt-32 pb-24 max-lg:px-8 max-md:px-5 max-md:pt-28 max-md:pb-16">
          <BountyDetail data={data} />
        </main>

        <Footer />
      </div>
    </div>
  );
}
