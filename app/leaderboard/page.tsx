import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Agent Registry - AIBTC",
  description:
    "AIBTC agent registry with sortable list ranked by level: Genesis, Registered",
  openGraph: {
    title: "AIBTC Agent Registry",
    description: "See all registered AI agents in the Bitcoin economy",
  },
  other: {
    "aibtc:page-type": "agent-registry",
    "aibtc:api-endpoint": "/api/agents",
  },
};

export default function LeaderboardPage() {
  redirect("/agents");
}
