import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { RelayRPC } from "@/lib/inbox/relay-rpc";
import type { SponsorStatusResult, SponsorStatusReason } from "./types";

type RelaySponsorStatusBinding = {
  getSponsorStatus?: RelayRPC["getSponsorStatus"];
};

const SPONSOR_STATUS_REASONS: SponsorStatusReason[] = [
  "NO_AVAILABLE_NONCES",
  "ALL_WALLETS_DEGRADED",
  "RECENT_CONFLICT",
  "HEAL_IN_PROGRESS",
  "RECONCILIATION_STALE",
  "SNAPSHOT_STALE",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isReason(value: unknown): value is SponsorStatusReason {
  return typeof value === "string" && SPONSOR_STATUS_REASONS.includes(value as SponsorStatusReason);
}

export function normalizeSponsorStatusResult(value: unknown): SponsorStatusResult | null {
  if (!isRecord(value)) return null;

  const {
    status,
    canSponsor,
    walletCount,
    recommendation,
    reasons,
    noncePool,
    reconciliation,
    snapshot,
  } = value;

  if (
    status !== "healthy" &&
    status !== "degraded" &&
    status !== "unavailable"
  ) {
    return null;
  }

  if (typeof canSponsor !== "boolean" || typeof walletCount !== "number") {
    return null;
  }

  if (recommendation !== null && recommendation !== "fallback_to_direct") {
    return null;
  }

  if (!Array.isArray(reasons) || !reasons.every(isReason)) {
    return null;
  }

  if (!isRecord(noncePool)) return null;
  if (!isRecord(reconciliation)) return null;
  if (!isRecord(snapshot)) return null;

  if (
    typeof noncePool.totalAvailable !== "number" ||
    typeof noncePool.totalReserved !== "number" ||
    typeof noncePool.totalCapacity !== "number" ||
    typeof noncePool.poolAvailabilityRatio !== "number" ||
    typeof noncePool.conflictsDetected !== "number" ||
    (noncePool.lastConflictAt !== null && typeof noncePool.lastConflictAt !== "string") ||
    typeof noncePool.healInProgress !== "boolean"
  ) {
    return null;
  }

  if (
    reconciliation.source !== "hiro" ||
    (reconciliation.lastSuccessfulAt !== null &&
      typeof reconciliation.lastSuccessfulAt !== "string") ||
    (reconciliation.freshness !== "fresh" &&
      reconciliation.freshness !== "stale" &&
      reconciliation.freshness !== "unavailable")
  ) {
    return null;
  }

  if (
    typeof snapshot.asOf !== "string" ||
    typeof snapshot.ageMs !== "number" ||
    (snapshot.freshness !== "fresh" &&
      snapshot.freshness !== "stale" &&
      snapshot.freshness !== "expired")
  ) {
    return null;
  }

  return {
    status,
    canSponsor,
    walletCount,
    recommendation,
    reasons,
    noncePool: {
      totalAvailable: noncePool.totalAvailable,
      totalReserved: noncePool.totalReserved,
      totalCapacity: noncePool.totalCapacity,
      poolAvailabilityRatio: noncePool.poolAvailabilityRatio,
      conflictsDetected: noncePool.conflictsDetected,
      lastConflictAt: noncePool.lastConflictAt,
      healInProgress: noncePool.healInProgress,
    },
    reconciliation: {
      source: reconciliation.source,
      lastSuccessfulAt: reconciliation.lastSuccessfulAt,
      freshness: reconciliation.freshness,
    },
    snapshot: {
      asOf: snapshot.asOf,
      ageMs: snapshot.ageMs,
      freshness: snapshot.freshness,
    },
  };
}

export async function getRelaySponsorStatusFromBinding(
  rpc: RelaySponsorStatusBinding | undefined
): Promise<SponsorStatusResult | null> {
  try {
    if (!rpc) return null;

    const getSponsorStatus = rpc.getSponsorStatus;
    if (typeof getSponsorStatus !== "function") return null;

    const result = await getSponsorStatus.call(rpc);
    return normalizeSponsorStatusResult(result);
  } catch {
    return null;
  }
}

export async function getRelaySponsorStatus(): Promise<SponsorStatusResult | null> {
  const { env } = await getCloudflareContext({ async: true });
  return getRelaySponsorStatusFromBinding(env.X402_RELAY as RelaySponsorStatusBinding | undefined);
}
