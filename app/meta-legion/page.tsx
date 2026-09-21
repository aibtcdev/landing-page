import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import MetaLegionView from "./MetaLegionView";
import { loadMetaLegionState } from "@/lib/meta-legion/server-state";
import "../legions/legions.css";
import "./meta-legion.css";

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--nl-font-mono",
  display: "swap",
});

// Reads the chain on request (edge-cached for two minutes).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Meta Legion",
  description:
    "Legion 0 of the Legion Exchange asks whether the exchange takes off: at least 50 legions clearing a real-trading bar in each of the last three epochs before the close. The contract answers it from its own scoreboard.",
  alternates: { canonical: "/meta-legion" },
};

export default async function MetaLegionPage() {
  const initial = await loadMetaLegionState();
  return (
    <div className={`nl ${mono.variable}`}>
      <Navbar />
      <MetaLegionView initial={initial} />
      <Footer />
    </div>
  );
}
