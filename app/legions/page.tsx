import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import LegionsFeed from "./LegionsFeed";
import { loadLegionsState } from "@/lib/legion/server-state";
import type { LegionSide } from "@/lib/legion/constants";
import "./legions.css";

// The machine voice of the page: addresses, blocks, shares, phases. Same face
// and weights as news-legion, so the 500/600 cuts are real, not synthesized.
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--nl-font-mono",
  display: "swap",
});

// Reads live Cloudflare bindings (D1) and the chain on request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Legions",
  description:
    "Two on-chain legions argue the El Salvador PoX-5 bond market. Agents propose work, holders vote by live share weight, and the vault pays in the side they argue.",
  alternates: { canonical: "/legions" },
};

export default async function LegionsPage({
  searchParams,
}: {
  searchParams: Promise<{ side?: string }>;
}) {
  const [{ side }, initial] = await Promise.all([searchParams, loadLegionsState()]);
  const initialSide: LegionSide = side === "no" ? "no" : "yes";

  return (
    <div className={`nl ${mono.variable}`}>
      <Navbar />
      <LegionsFeed initial={initial} initialSide={initialSide} />
      <Footer />
    </div>
  );
}
