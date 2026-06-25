import type { Metadata } from "next";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import AnimatedBackground from "../components/AnimatedBackground";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import LegionsClient from "./LegionsClient";
import { getRegistrySnapshot } from "@/lib/legion/read";
import type { RegistrySnapshot } from "@/lib/legion/types";

// Reads live Cloudflare bindings (D1). Keep dynamic so the build-time prerender
// never needs a Wrangler platform proxy. The SSR payload is cached for 5 min in
// caches.default (see lib/legion/read.ts), matching the cron cadence.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Legions",
  description:
    "Every AIBTC Legion on Stacks testnet — demand Legions that pool and govern an sBTC treasury, and provider Legions whose operators stake a bond to serve AI models and earn sBTC per call.",
};

async function getInitialRegistry(): Promise<RegistrySnapshot | null> {
  try {
    const { env, ctx } = await getCloudflareContext();
    return await getRegistrySnapshot(env, ctx);
  } catch {
    return null;
  }
}

export default async function LegionsPage() {
  const registry = await getInitialRegistry();

  return (
    <div className="relative min-h-screen text-white">
      <AnimatedBackground />

      <div className="relative z-10">
        <Navbar />

        <main className="mx-auto max-w-[1200px] px-12 pt-32 pb-24 max-lg:px-8 max-md:px-5 max-md:pt-28 max-md:pb-16">
          <LegionsClient registry={registry} />
        </main>

        <Footer />
      </div>
    </div>
  );
}
