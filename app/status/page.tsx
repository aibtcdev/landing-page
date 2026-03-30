import { Suspense } from "react";
import type { Metadata } from "next";
import AnimatedBackground from "../components/AnimatedBackground";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import RelayStatus from "./RelayStatus";
import { getStatusData } from "./data";

export const revalidate = 120;

export const metadata: Metadata = {
  title: "Relay Status",
  description:
    "Live health dashboard for the x402 sponsor relay with relay-owned sponsor readiness, nonce pool, and freshness metadata.",
};

export default async function StatusPage() {
  const initialData = await getStatusData();

  return (
    <div className="relative min-h-screen text-white">
      <AnimatedBackground />

      <div className="relative z-10">
        <Navbar />

        <main className="mx-auto max-w-[1200px] px-12 pt-32 pb-24 max-lg:px-8 max-md:px-5 max-md:pt-28 max-md:pb-16">
          <Suspense
            fallback={
              <section
                className="space-y-6"
                aria-busy="true"
                aria-label="Loading relay status"
              >
                <div className="h-10 w-64 rounded-lg bg-white/5" />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {[...Array(4)].map((_, i) => (
                    <div
                      key={i}
                      className="h-32 rounded-xl border border-white/5 bg-white/5"
                    />
                  ))}
                </div>
              </section>
            }
          >
            <RelayStatus initialData={initialData} />
          </Suspense>
        </main>

        <Footer />
      </div>
    </div>
  );
}
