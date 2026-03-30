/** Result of sponsor key provisioning attempt. */
export type SponsorKeyResult =
  | { success: true; apiKey: string }
  | { success: false; error: string; status?: number };

export type SponsorStatusLevel = "healthy" | "degraded" | "unavailable";

export type SponsorSnapshotFreshness = "fresh" | "stale" | "expired";

export type SponsorReconciliationFreshness = "fresh" | "stale" | "unavailable";

export type SponsorStatusReason =
  | "NO_AVAILABLE_NONCES"
  | "ALL_WALLETS_DEGRADED"
  | "RECENT_CONFLICT"
  | "HEAL_IN_PROGRESS"
  | "RECONCILIATION_STALE"
  | "SNAPSHOT_STALE";

export interface SponsorStatusResult {
  status: SponsorStatusLevel;
  canSponsor: boolean;
  walletCount: number;
  recommendation: "fallback_to_direct" | null;
  reasons: SponsorStatusReason[];
  noncePool: {
    totalAvailable: number;
    totalReserved: number;
    totalCapacity: number;
    poolAvailabilityRatio: number;
    conflictsDetected: number;
    lastConflictAt: string | null;
    healInProgress: boolean;
  };
  reconciliation: {
    source: "hiro";
    lastSuccessfulAt: string | null;
    freshness: SponsorReconciliationFreshness;
  };
  snapshot: {
    asOf: string;
    ageMs: number;
    freshness: SponsorSnapshotFreshness;
  };
}
