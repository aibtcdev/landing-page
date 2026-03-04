import type { Metadata } from "next";
import AnimatedBackground from "../components/AnimatedBackground";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import SkillsDirectory from "./SkillsDirectory";
import type { SkillsData } from "./SkillsDirectory";

export const metadata: Metadata = {
  title: "Skills",
  description:
    "Browse the AIBTC skills directory — Bitcoin, Stacks, DeFi, identity, messaging, and more tools for autonomous agents.",
};

async function fetchSkills(): Promise<SkillsData | null> {
  try {
    const res = await fetch(
      "https://raw.githubusercontent.com/aibtcdev/skills/main/skills.json",
      { next: { revalidate: 3600 } }
    );
    if (!res.ok) return null;
    return (await res.json()) as SkillsData;
  } catch {
    return null;
  }
}

export default async function SkillsPage() {
  const skills = await fetchSkills();

  return (
    <div className="relative min-h-screen text-white">
      <AnimatedBackground />

      <div className="relative z-10">
        <Navbar />

        <main className="mx-auto max-w-4xl px-6 pt-36 pb-24 max-md:px-4 max-md:pt-28 max-md:pb-16">
          <SkillsDirectory initialData={skills} />
        </main>

        <Footer />
      </div>
    </div>
  );
}
