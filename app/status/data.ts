import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  getRelaySponsorStatusFromBinding,
  type RelaySponsorStatusBinding,
} from "@/lib/sponsor/status";
import { STATUS_REVALIDATE_SECONDS } from "./constants";
import type { MainnetHealth, StatusData, TestnetHealth } from "./types";

async function fetchMainnetHealth(): Promise<MainnetHealth | null> {
  try {
    const res = await fetch("https://x402.aibtc.com/health", {
      next: { revalidate: STATUS_REVALIDATE_SECONDS },
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
      next: { revalidate: STATUS_REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;
    return (await res.json()) as TestnetHealth;
  } catch {
    return null;
  }
}

async function getRelaySponsorStatusWithGracefulContext(): Promise<StatusData["sponsorStatus"]> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return getRelaySponsorStatusFromBinding(
      env.X402_RELAY as RelaySponsorStatusBinding | undefined
    );
  } catch {
    return null;
  }
}

export async function getStatusData(): Promise<StatusData> {
  const [mainnet, testnet, sponsorStatus] = await Promise.all([
    fetchMainnetHealth(),
    fetchTestnetHealth(),
    getRelaySponsorStatusWithGracefulContext(),
  ]);

  return {
    mainnet,
    testnet,
    sponsorStatus,
  };
}
