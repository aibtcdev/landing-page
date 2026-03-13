import { Suspense } from "react";
import type { Metadata } from "next";
import AnimatedBackground from "../components/AnimatedBackground";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import RelayStatus from "./RelayStatus";
import { SPONSOR_ADDRESS } from "./constants";

export const metadata: Metadata = {
  title: "Relay Status",
  description:
    "Live health dashboard for the x402 sponsor relay — mainnet and testnet status, nonce state, and sponsor wallet balance.",
};

export interface MainnetHealth {
  status: string;
  environment: string;
  timestamp: string;
}

export interface TestnetHealth {
  success: boolean;
  status: string;
  network: string;
  version: string;
  nonce: {
    poolAvailable: number;
    poolReserved: number;
    conflictsDetected: number;
    circuitBreakerOpen: boolean;
    lastConflictAt: string | null;
  };
}

export interface NonceData {
  last_executed_tx_nonce: number | null;
  last_mempool_tx_nonce: number | null;
  possible_next_nonce: number;
  detected_missing_nonces: number[];
}

export interface StatusData {
  mainnet: MainnetHealth | null;
  testnet: TestnetHealth | null;
  nonce: NonceData | null;
  stxBalance: number | null;
}

async function fetchMainnetHealth(): Promise<MainnetHealth | null> {
  try {
    const res = await fetch("https://x402.aibtc.com/health", {
      next: { revalidate: 30 },
    });
    if (!res.ok) return null;
    return (await res.json()) as MainnetHealth;
  } catch {
    return null;
  }
}

async function fetchTestnetHealth(): Promise<TestnetHealth | null> {
  try {
    const res = await fetch("https://x402-relay.aibtc.dev/health", {
      next: { revalidate: 30 },
    });
    if (!res.ok) return null;
    return (await res.json()) as TestnetHealth;
  } catch {
    return null;
  }
}

async function fetchNonce(): Promise<NonceData | null> {
  try {
    const res = await fetch(
      `https://api.hiro.so/extended/v1/address/${SPONSOR_ADDRESS}/nonces`,
      { next: { revalidate: 30 } }
    );
    if (!res.ok) return null;
    return (await res.json()) as NonceData;
  } catch {
    return null;
  }
}

async function fetchStxBalance(): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.hiro.so/extended/v1/address/${SPONSOR_ADDRESS}/stx`,
      { next: { revalidate: 30 } }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    if (typeof data.balance !== "string" && typeof data.balance !== "number") return null;
    return Number(data.balance) / 1_000_000;
  } catch {
    return null;
  }
}

export default async function StatusPage() {
  const [mainnet, testnet, nonce, stxBalance] = await Promise.all([
    fetchMainnetHealth(),
    fetchTestnetHealth(),
    fetchNonce(),
    fetchStxBalance(),
  ]);

  const initialData: StatusData = { mainnet, testnet, nonce, stxBalance };

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
