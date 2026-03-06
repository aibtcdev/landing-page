import { Suspense } from "react";
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

        <main className="mx-auto max-w-[1100px] px-12 pt-32 pb-24 max-lg:px-8 max-md:px-5 max-md:pt-28 max-md:pb-16">
          <Suspense
            fallback={
              <section
                className="space-y-6"
                aria-busy="true"
                aria-label="Loading skills directory"
              >
                <div className="h-10 w-64 rounded-lg bg-white/5" />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {[...Array(6)].map((_, index) => (
                    <div
                      key={index}
                      className="h-40 rounded-xl border border-white/5 bg-white/5"
                    />
                  ))}
                </div>
              </section>
            }
          >
            <SkillsDirectory initialData={skills} />
          </Suspense>
        </main>

        <Footer />
      </div>
    </div>
  );
}
