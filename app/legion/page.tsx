import type { Metadata } from "next";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import AnimatedBackground from "../components/AnimatedBackground";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import LegionClient from "./LegionClient";
import { readLegionSnapshot } from "@/lib/legion/snapshot";
import type { LegionSnapshot } from "@/lib/legion/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Legion",
  description:
    "Live dashboard for an AIBTC Legion on Stacks testnet — pooled sBTC treasury, stake-weighted members, and the full block-height lifecycle of every governance proposal.",
};

/**
 * SSR reads the cron-built snapshot straight from KV (one read, no Hiro fan-out)
 * for an instant first paint. If KV is cold (before the first cron tick) we hand
 * the client `null` and let it call /api/legion, which builds + warms the blob.
 */
async function getInitialSnapshot(): Promise<LegionSnapshot | null> {
  try {
    const { env } = await getCloudflareContext();
    const kv = env.LEGION as KVNamespace | undefined;
    if (!kv) return null;
    return await readLegionSnapshot(kv);
  } catch {
    return null;
  }
}

export default async function LegionPage() {
  const initialData = await getInitialSnapshot();

  return (
    <div className="relative min-h-screen text-white">
      <AnimatedBackground />

      <div className="relative z-10">
        <Navbar />

        <main className="mx-auto max-w-[1200px] px-12 pt-32 pb-24 max-lg:px-8 max-md:px-5 max-md:pt-28 max-md:pb-16">
          <LegionClient initialData={initialData} />
        </main>

        <Footer />
      </div>
    </div>
  );
}
