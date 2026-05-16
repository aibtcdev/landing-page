import type { Metadata } from "next";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import AnimatedBackground from "../../components/AnimatedBackground";
import Navbar from "../../components/Navbar";
import Footer from "../../components/Footer";
import BountyDetail from "./BountyDetail";
import type { BountyDetailData, BountyWithStatus } from "../types";
import {
  bountyStatus,
  buildExpectedMemo,
  getBounty,
  getSubmission,
  listSubmissionsForBounty,
  SBTC_CONTRACT_MAINNET,
  type BountyPaymentHint,
  type BountyWinner,
} from "@/lib/bounty";
import { lookupAgent } from "@/lib/agent-lookup";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function fetchBountyDetail(id: string): Promise<BountyDetailData | null> {
  try {
    const { env } = await getCloudflareContext();
    const db = env.DB as D1Database | undefined;
    const kv = env.VERIFIED_AGENTS as KVNamespace | undefined;
    if (!db) return null;

    const bounty = await getBounty(db, id);
    if (!bounty) return null;

    const now = new Date();
    const status = bountyStatus(bounty, now);
    const { submissions, total } = await listSubmissionsForBounty(db, id, 20, 0);

    let winner: BountyWinner | undefined;
    if (bounty.acceptedSubmissionId && bounty.acceptedAt) {
      const winningSub =
        submissions.find((s) => s.id === bounty.acceptedSubmissionId) ??
        (await getSubmission(db, bounty.acceptedSubmissionId));
      if (winningSub) {
        winner = {
          submissionId: winningSub.id,
          submitterBtcAddress: winningSub.submitterBtcAddress,
          submitterStxAddress: winningSub.submitterStxAddress,
          ...(winningSub.contentUrl && { contentUrl: winningSub.contentUrl }),
          message: winningSub.message,
          acceptedAt: bounty.acceptedAt,
        };
      }
    }

    let payment: BountyPaymentHint | undefined;
    if (status === "winner-announced" && winner) {
      const memo = buildExpectedMemo(bounty.id);
      payment = {
        expectedMemo: memo.ascii,
        expectedMemoHex: memo.hex,
        recipientStxAddress: winner.submitterStxAddress,
        amountSats: bounty.rewardSats,
        sbtcContract: SBTC_CONTRACT_MAINNET,
      };
    }

    // Enrich with display names for every actor on the page (poster + all
    // submitters). Dedupe so we don't look up the same address twice.
    const addressesToLookup = Array.from(
      new Set([bounty.posterBtcAddress, ...submissions.map((s) => s.submitterBtcAddress)])
    );
    const agentNames: Record<string, string> = {};
    if (kv) {
      const lookups = await Promise.all(
        addressesToLookup.map(async (addr) => [addr, await lookupAgent(kv, addr, db)] as const)
      );
      for (const [addr, agent] of lookups) {
        if (agent?.displayName) agentNames[addr] = agent.displayName;
      }
    }

    const decorated: BountyWithStatus = {
      ...bounty,
      status,
      ...(agentNames[bounty.posterBtcAddress] && {
        posterDisplayName: agentNames[bounty.posterBtcAddress],
      }),
    };
    return {
      bounty: decorated,
      submissions,
      submissionCount: total,
      ...(winner && { winner }),
      ...(payment && { payment }),
      agentNames,
    };
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  try {
    const data = await fetchBountyDetail(id);
    if (data) {
      return {
        title: data.bounty.title,
        description: data.bounty.description.slice(0, 160),
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
