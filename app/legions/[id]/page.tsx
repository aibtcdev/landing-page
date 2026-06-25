import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import AnimatedBackground from "../../components/AnimatedBackground";
import Navbar from "../../components/Navbar";
import Footer from "../../components/Footer";
import LegionClient from "../../legion/LegionClient";
import ProviderClient from "../../legion/ProviderClient";
import {
  getLegionSnapshot,
  getProviderSnapshot,
  resolveLegionEntry,
} from "@/lib/legion/read";
import type { LegionEntry } from "@/lib/legion/types";

// Reads live Cloudflare bindings (D1). Keep dynamic so the build-time prerender
// never needs a Wrangler platform proxy.
export const dynamic = "force-dynamic";

async function resolve(id: string): Promise<LegionEntry | null> {
  try {
    const { env, ctx } = await getCloudflareContext();
    return await resolveLegionEntry(env, ctx, id);
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const entry = await resolve(id);
  if (!entry) return { title: "Legion not found" };
  const kindLabel = entry.kind === "provider" ? "provider Legion" : "demand Legion";
  return {
    title: entry.uri || `Legion #${entry.id}`,
    description:
      entry.kind === "provider"
        ? `Live dashboard for an AIBTC ${kindLabel} on Stacks testnet — bonded inference operators serving ${entry.model || "a model"}, earning sBTC per call.`
        : `Live dashboard for an AIBTC ${kindLabel} on Stacks testnet — pooled sBTC treasury, stake-weighted members, and the full lifecycle of every governance proposal.`,
  };
}

export default async function LegionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const entry = await resolve(id);
  if (!entry) notFound();

  let body: React.ReactNode;
  try {
    const { env, ctx } = await getCloudflareContext();
    if (entry.kind === "provider") {
      const snapshot = await getProviderSnapshot(env, ctx, entry);
      body = <ProviderClient snapshot={snapshot} />;
    } else {
      const snapshot = await getLegionSnapshot(env, ctx, undefined, entry.id, entry);
      body = <LegionClient snapshot={snapshot} entry={entry} />;
    }
  } catch {
    body =
      entry.kind === "provider" ? (
        <ProviderClient snapshot={null} />
      ) : (
        <LegionClient snapshot={null} entry={entry} />
      );
  }

  return (
    <div className="relative min-h-screen text-white">
      <AnimatedBackground />

      <div className="relative z-10">
        <Navbar />

        <main className="mx-auto max-w-[1200px] px-12 pt-32 pb-24 max-lg:px-8 max-md:px-5 max-md:pt-28 max-md:pb-16">
          {body}
        </main>

        <Footer />
      </div>
    </div>
  );
}
