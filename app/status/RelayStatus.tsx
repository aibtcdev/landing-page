"use client";

import { useState, useEffect, useCallback } from "react";
import type { SponsorStatusResult } from "@/lib/sponsor/types";
import { STATUS_REFRESH_INTERVAL_MS } from "./constants";
import type { StatusData } from "./types";

interface OverallStatus {
  overall: "healthy" | "degraded" | "down";
  mainnetOk: boolean;
  testnetOk: boolean;
  sponsorOk: boolean;
}

function deriveOverallStatus(data: StatusData): OverallStatus {
  const mainnetOk = data.mainnet?.status === "ok" || data.mainnet?.status === "healthy";
  const testnetOk = data.testnet?.success === true;
  const sponsorOk =
    data.sponsorStatus?.status === "healthy" && data.sponsorStatus.canSponsor;

  let overall: "healthy" | "degraded" | "down";
  if (!data.mainnet && !data.testnet && !data.sponsorStatus) overall = "down";
  else if (mainnetOk && testnetOk && sponsorOk) overall = "healthy";
  else if (
    mainnetOk ||
    testnetOk ||
    data.sponsorStatus?.status === "healthy" ||
    data.sponsorStatus?.status === "degraded"
  ) {
    overall = "degraded";
  } else {
    overall = "down";
  }

  return { overall, mainnetOk, testnetOk, sponsorOk };
}

function statusLabel(s: "healthy" | "degraded" | "down"): string {
  if (s === "healthy") return "All Systems Operational";
  if (s === "degraded") return "Partial Outage";
  return "Service Disruption";
}

function dotColor(s: "healthy" | "degraded" | "down"): string {
  if (s === "healthy") return "bg-emerald-400";
  if (s === "degraded") return "bg-amber-400";
  return "bg-red-400";
}

function relayDotColor(ok: boolean | null): string {
  if (ok === null) return "bg-white/20";
  return ok ? "bg-emerald-400" : "bg-red-400";
}

function sponsorStatusTone(status: SponsorStatusResult["status"] | null): string {
  if (status === "healthy") return "text-emerald-400";
  if (status === "degraded") return "text-amber-400";
  if (status === "unavailable") return "text-red-400";
  return "text-white/30";
}

function freshnessTone(
  freshness: SponsorStatusResult["snapshot"]["freshness"] | null
): string {
  if (freshness === "fresh") return "text-emerald-400";
  if (freshness === "stale") return "text-amber-400";
  if (freshness === "expired") return "text-red-400";
  return "text-white/30";
}

function formatTs(ts: string | null | undefined): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return ts;
  }
}

function formatAgeMs(ageMs: number): string {
  if (ageMs < 1000) return `${ageMs}ms`;
  const totalSeconds = Math.round(ageMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

async function fetchAll(): Promise<StatusData> {
  const response = await fetch("/api/status/summary", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Status refresh failed with ${response.status}`);
  }
  return (await response.json()) as StatusData;
}

export default function RelayStatus({ initialData }: { initialData: StatusData }) {
  const [data, setData] = useState<StatusData>(initialData);
  const [lastUpdated, setLastUpdated] = useState<Date>(() => new Date());
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const fresh = await fetchAll();
      setData(fresh);
      setLastUpdated(new Date());
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, STATUS_REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const { overall, mainnetOk, testnetOk, sponsorOk } = deriveOverallStatus(data);
  const sponsorStatus = data.sponsorStatus;
  const reasonList = sponsorStatus?.reasons.length ? sponsorStatus.reasons.join(", ") : "None";

  return (
    <>
      <div className="mb-10 max-md:mb-7">
        <h1 className="mb-3 text-[clamp(28px,3.5vw,42px)] font-medium leading-[1.1] tracking-tight text-white">
          Relay Status
        </h1>
        <p className="max-w-[560px] text-[18px] leading-[1.6] text-white/70 max-md:text-[16px]">
          Live health for the x402 sponsor relay with relay-owned sponsor readiness and
          snapshot freshness for gasless agent transactions.
        </p>
      </div>

      <div
        className={`mb-8 flex items-center justify-between gap-4 rounded-xl border p-5 max-md:flex-col max-md:items-start ${
          overall === "healthy"
            ? "border-emerald-400/20 bg-emerald-400/[0.04]"
            : overall === "degraded"
              ? "border-amber-400/20 bg-amber-400/[0.04]"
              : "border-red-400/20 bg-red-400/[0.04]"
        }`}
      >
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3 shrink-0">
            <span
              className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:animate-none ${dotColor(overall)}`}
            />
            <span className={`relative inline-flex h-3 w-3 rounded-full ${dotColor(overall)}`} />
          </span>
          <span className="text-[17px] font-medium text-white/90">{statusLabel(overall)}</span>
        </div>

        <div className="flex items-center gap-3 text-[13px] text-white/40">
          <span>Updated {lastUpdated ? formatTs(lastUpdated.toISOString()) : "—"}</span>
          <button
            onClick={refresh}
            disabled={refreshing}
            aria-label="Refresh status"
            className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[12px] text-white/50 transition-all hover:bg-white/[0.06] hover:text-white/70 disabled:opacity-40"
          >
            <svg
              aria-hidden="true"
              className={`size-3 ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-widest text-white/40">
              Mainnet Relay
            </p>
            <span className="relative flex h-2.5 w-2.5">
              {mainnetOk && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50 motion-reduce:animate-none" />
              )}
              <span
                className={`relative inline-flex h-2.5 w-2.5 rounded-full ${relayDotColor(
                  data.mainnet ? mainnetOk : null
                )}`}
              />
            </span>
          </div>

          {data.mainnet ? (
            <div className="space-y-3">
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-[22px] font-medium leading-none ${
                    mainnetOk ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {data.mainnet.status}
                </span>
              </div>
              <dl className="space-y-1.5 text-[13px]">
                <div className="flex justify-between">
                  <dt className="text-white/40">Environment</dt>
                  <dd className="text-white/70">{data.mainnet.environment ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-white/40">Timestamp</dt>
                  <dd className="font-mono text-[12px] text-white/60">
                    {formatTs(data.mainnet.timestamp)}
                  </dd>
                </div>
              </dl>
            </div>
          ) : (
            <p className="text-[14px] text-red-400/70">Unreachable</p>
          )}
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-widest text-white/40">
              Testnet Relay
            </p>
            <span className="relative flex h-2.5 w-2.5">
              {testnetOk && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50 motion-reduce:animate-none" />
              )}
              <span
                className={`relative inline-flex h-2.5 w-2.5 rounded-full ${relayDotColor(
                  data.testnet ? testnetOk : null
                )}`}
              />
            </span>
          </div>

          {data.testnet ? (
            <div className="space-y-3">
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-[22px] font-medium leading-none ${
                    testnetOk ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {data.testnet.status}
                </span>
              </div>
              <dl className="space-y-1.5 text-[13px]">
                <div className="flex justify-between">
                  <dt className="text-white/40">Network</dt>
                  <dd className="text-white/70">{data.testnet.network ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-white/40">Version</dt>
                  <dd className="font-mono text-[12px] text-white/60">
                    {data.testnet.version ?? "—"}
                  </dd>
                </div>
              </dl>
            </div>
          ) : (
            <p className="text-[14px] text-red-400/70">Unreachable</p>
          )}
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
          <p className="mb-4 text-[11px] font-medium uppercase tracking-widest text-white/40">
            Sponsor Status
          </p>
          {sponsorStatus ? (
            <dl className="space-y-2 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-white/40">Status</dt>
                <dd className={`font-medium capitalize ${sponsorStatusTone(sponsorStatus.status)}`}>
                  {sponsorStatus.status}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/40">Can sponsor</dt>
                <dd
                  className={
                    sponsorStatus.canSponsor
                      ? "text-emerald-400"
                      : sponsorStatus.status === "unavailable"
                        ? "text-red-400"
                        : "text-amber-400"
                  }
                >
                  {sponsorStatus.canSponsor ? "Yes" : "No"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/40">Wallets</dt>
                <dd className="tabular-nums text-white/80">{sponsorStatus.walletCount}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/40">Recommendation</dt>
                <dd className="text-white/70">{sponsorStatus.recommendation ?? "None"}</dd>
              </div>
              <div className="pt-1">
                <dt className="mb-1 text-white/40">Reasons</dt>
                <dd className="text-white/60">{reasonList}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-[13px] text-white/30">
              Relay sponsor snapshot unavailable from the RPC binding.
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
          <p className="mb-4 text-[11px] font-medium uppercase tracking-widest text-white/40">
            Nonce Pool
          </p>
          {sponsorStatus ? (
            <dl className="space-y-2 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-white/40">Available</dt>
                <dd className="tabular-nums text-white/80">
                  {sponsorStatus.noncePool.totalAvailable}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/40">Reserved</dt>
                <dd className="tabular-nums text-white/80">
                  {sponsorStatus.noncePool.totalReserved}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/40">Capacity</dt>
                <dd className="tabular-nums text-white/80">
                  {sponsorStatus.noncePool.totalCapacity}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/40">Available ratio</dt>
                <dd className="tabular-nums text-white/80">
                  {formatPercent(sponsorStatus.noncePool.poolAvailabilityRatio)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/40">Conflicts</dt>
                <dd
                  className={`tabular-nums ${
                    sponsorStatus.noncePool.conflictsDetected > 0
                      ? "text-amber-400"
                      : "text-white/80"
                  }`}
                >
                  {sponsorStatus.noncePool.conflictsDetected}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/40">Healing</dt>
                <dd className={sponsorStatus.noncePool.healInProgress ? "text-amber-400" : "text-emerald-400"}>
                  {sponsorStatus.noncePool.healInProgress ? "In progress" : "Idle"}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-[13px] text-white/30">No data</p>
          )}
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
          <p className="mb-4 text-[11px] font-medium uppercase tracking-widest text-white/40">
            Snapshot Freshness
          </p>
          {sponsorStatus ? (
            <dl className="space-y-2 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-white/40">Snapshot</dt>
                <dd className={`capitalize ${freshnessTone(sponsorStatus.snapshot.freshness)}`}>
                  {sponsorStatus.snapshot.freshness}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/40">Snapshot age</dt>
                <dd className="tabular-nums text-white/80">
                  {formatAgeMs(sponsorStatus.snapshot.ageMs)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/40">Snapshot as of</dt>
                <dd className="font-mono text-[12px] text-white/60">
                  {formatTs(sponsorStatus.snapshot.asOf)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/40">Reconciliation</dt>
                <dd className="capitalize text-white/70">
                  {sponsorStatus.reconciliation.freshness}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/40">Last success</dt>
                <dd className="font-mono text-[12px] text-white/60">
                  {formatTs(sponsorStatus.reconciliation.lastSuccessfulAt)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/40">Last conflict</dt>
                <dd className="font-mono text-[12px] text-white/60">
                  {formatTs(sponsorStatus.noncePool.lastConflictAt)}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-[13px] text-white/30">No relay snapshot returned.</p>
          )}
        </div>
      </div>

      <p className="mt-6 text-[12px] text-white/25">
        Auto-refreshes every 120 seconds through the landing-page server. Relay readiness
        comes from the relay RPC snapshot, while mainnet and testnet health remain thin
        readiness signals from{" "}
        <a
          href="https://x402.aibtc.com/health"
          target="_blank"
          rel="noopener noreferrer"
          className="text-white/40 underline underline-offset-2 hover:text-white/60"
        >
          x402.aibtc.com
        </a>{" "}
        and{" "}
        <a
          href="https://x402-relay.aibtc.dev/health"
          target="_blank"
          rel="noopener noreferrer"
          className="text-white/40 underline underline-offset-2 hover:text-white/60"
        >
          x402-relay.aibtc.dev
        </a>
        .
      </p>
    </>
  );
}
