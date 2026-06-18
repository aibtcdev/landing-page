import type { Metadata } from "next";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import AnimatedBackground from "../components/AnimatedBackground";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import LegionClient from "./LegionClient";
import { getLegionSnapshot } from "@/lib/legion/read";
import type { LegionSnapshot } from "@/lib/legion/types";

// Reads live Cloudflare bindings (D1). Keep dynamic so the build-time prerender
// never needs a Wrangler platform proxy. The SSR payload is cached for 5 min in
// caches.default (see lib/legion/read.ts), matching the cron cadence.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Legion",
  description:
    "Live dashboard for an AIBTC Legion on Stacks testnet — pooled sBTC treasury, stake-weighted members, and the full block-height lifecycle of every governance proposal.",
};

async function getInitialSnapshot(): Promise<LegionSnapshot | null> {
  try {
    const { env, ctx } = await getCloudflareContext();
    return await getLegionSnapshot(env, ctx);
  } catch {
    return null;
  }
}

export default async function LegionPage() {
  const snapshot = await getInitialSnapshot();

  return (
    <div className="relative min-h-screen text-white">
      <AnimatedBackground />

      <div className="relative z-10">
        <Navbar />

        <main className="mx-auto max-w-[1200px] px-12 pt-32 pb-24 max-lg:px-8 max-md:px-5 max-md:pt-28 max-md:pb-16">
          <LegionClient snapshot={snapshot} />
        </main>

        <Footer />
      </div>
    </div>
  );
}
