"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  StatusData,
  MainnetHealth,
  TestnetHealth,
  NonceData,
} from "./page";
import { SPONSOR_ADDRESS } from "./constants";

const REFRESH_INTERVAL_MS = 30_000;

/* ─── Helpers ─── */

interface OverallStatus {
  overall: "healthy" | "degraded" | "down";
  mainnetOk: boolean;
  testnetOk: boolean;
}

function deriveOverallStatus(data: StatusData): OverallStatus {
  const mainnetOk = data.mainnet?.status === "ok" || data.mainnet?.status === "healthy";
  const testnetOk = data.testnet?.success === true;
  let overall: "healthy" | "degraded" | "down";
  if (!data.mainnet && !data.testnet) overall = "down";
  else if (mainnetOk && testnetOk) overall = "healthy";
  else if (mainnetOk || testnetOk) overall = "degraded";
  else overall = "down";
  return { overall, mainnetOk, testnetOk };
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

function formatTs(ts: string | null | undefined): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return ts;
  }
}

function shortAddr(addr: string): string {
  return addr.slice(0, 8) + "..." + addr.slice(-6);
}

/* ─── Fetch helpers (client-side refresh) ─── */

async function fetchAll(): Promise<StatusData> {
  const [mainnet, testnet, nonce, stxData] = await Promise.allSettled([
    fetch("https://x402.aibtc.com/health").then((r) => (r.ok ? r.json() : null)),
    fetch("https://x402-relay.aibtc.dev/health").then((r) => (r.ok ? r.json() : null)),
    fetch(`https://api.hiro.so/extended/v1/address/${SPONSOR_ADDRESS}/nonces`).then((r) =>
      r.ok ? r.json() : null
    ),
    fetch(`https://api.hiro.so/extended/v1/address/${SPONSOR_ADDRESS}/stx`).then((r) =>
      r.ok ? r.json() : null
    ),
  ]);

  const mainnetVal = mainnet.status === "fulfilled" ? (mainnet.value as MainnetHealth | null) : null;
  const testnetVal = testnet.status === "fulfilled" ? (testnet.value as TestnetHealth | null) : null;
  const nonceVal = nonce.status === "fulfilled" ? (nonce.value as NonceData | null) : null;
  const stxRaw = stxData.status === "fulfilled" ? (stxData.value as Record<string, unknown> | null) : null;
  const stxBalance =
    stxRaw && (typeof stxRaw.balance === "string" || typeof stxRaw.balance === "number")
      ? Number(stxRaw.balance) / 1_000_000
      : null;

  return { mainnet: mainnetVal, testnet: testnetVal, nonce: nonceVal, stxBalance };
}

/* ─── Component ─── */

export default function RelayStatus({ initialData }: { initialData: StatusData }) {
  const [data, setData] = useState<StatusData>(initialData);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
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
    setLastUpdated(new Date());
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const { overall, mainnetOk, testnetOk } = deriveOverallStatus(data);

  return (
    <>
      {/* ─── Hero header ─── */}
      <div className="mb-10 max-md:mb-7">
        <h1 className="mb-3 text-[clamp(28px,3.5vw,42px)] font-medium leading-[1.1] tracking-tight text-white">
          Relay Status
        </h1>
        <p className="max-w-[560px] text-[18px] max-md:text-[16px] leading-[1.6] text-white/70">
          Live health for the x402 sponsor relay — gasless transactions for agents on
          mainnet and testnet.
        </p>
      </div>

      {/* ─── Overall health banner ─── */}
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
          {/* Animated pulse dot */}
          <span className="relative flex h-3 w-3 shrink-0">
            <span
              className={`absolute inline-flex h-full w-full animate-ping motion-reduce:animate-none rounded-full opacity-60 ${dotColor(overall)}`}
            />
            <span
              className={`relative inline-flex h-3 w-3 rounded-full ${dotColor(overall)}`}
            />
          </span>
          <span className="text-[17px] font-medium text-white/90">
            {statusLabel(overall)}
          </span>
        </div>

        {/* Last updated + manual refresh */}
        <div className="flex items-center gap-3 text-[13px] text-white/40">
          <span>
            Updated {lastUpdated ? formatTs(lastUpdated.toISOString()) : "—"}
          </span>
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

      {/* ─── Relay cards ─── */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        {/* Mainnet relay */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-widest text-white/40">
              Mainnet Relay
            </p>
            <span className="relative flex h-2.5 w-2.5">
              {mainnetOk && (
                <span className="absolute inline-flex h-full w-full animate-ping motion-reduce:animate-none rounded-full bg-emerald-400 opacity-50" />
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

        {/* Testnet relay */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-widest text-white/40">
              Testnet Relay
            </p>
            <span className="relative flex h-2.5 w-2.5">
              {testnetOk && (
                <span className="absolute inline-flex h-full w-full animate-ping motion-reduce:animate-none rounded-full bg-emerald-400 opacity-50" />
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
      </div>

      {/* ─── Nonce + wallet row ─── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Nonce pool (testnet) */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
          <p className="mb-4 text-[11px] font-medium uppercase tracking-widest text-white/40">
            Nonce Pool (Testnet)
          </p>
          {data.testnet?.nonce ? (
            <dl className="space-y-2 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-white/40">Available</dt>
                <dd className="tabular-nums text-white/80">
                  {data.testnet.nonce.poolAvailable}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/40">Reserved</dt>
                <dd className="tabular-nums text-white/80">
                  {data.testnet.nonce.poolReserved}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/40">Conflicts</dt>
                <dd
                  className={`tabular-nums ${
                    data.testnet.nonce.conflictsDetected > 0
                      ? "text-amber-400"
                      : "text-white/80"
                  }`}
                >
                  {data.testnet.nonce.conflictsDetected}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/40">Circuit breaker</dt>
                <dd
                  className={
                    data.testnet.nonce.circuitBreakerOpen
                      ? "text-red-400"
                      : "text-emerald-400"
                  }
                >
                  {data.testnet.nonce.circuitBreakerOpen ? "Open" : "Closed"}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-[13px] text-white/30">No data</p>
          )}
        </div>

        {/* Sponsor nonces (mainnet) */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
          <p className="mb-4 text-[11px] font-medium uppercase tracking-widest text-white/40">
            Sponsor Nonces (Mainnet)
          </p>
          {data.nonce ? (
            <dl className="space-y-2 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-white/40">Last executed</dt>
                <dd className="tabular-nums text-white/80">
                  {data.nonce.last_executed_tx_nonce ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/40">Last mempool</dt>
                <dd className="tabular-nums text-white/80">
                  {data.nonce.last_mempool_tx_nonce ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/40">Next nonce</dt>
                <dd className="tabular-nums text-white/80">
                  {data.nonce.possible_next_nonce}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-white/40">Gaps detected</dt>
                <dd
                  className={`tabular-nums ${
                    data.nonce.detected_missing_nonces.length > 0
                      ? "text-amber-400"
                      : "text-white/80"
                  }`}
                >
                  {data.nonce.detected_missing_nonces.length}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-[13px] text-white/30">No data</p>
          )}
        </div>

        {/* Sponsor wallet */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 sm:col-span-2 lg:col-span-1">
          <p className="mb-4 text-[11px] font-medium uppercase tracking-widest text-white/40">
            Sponsor Wallet
          </p>
          <div className="mb-3">
            {data.stxBalance !== null ? (
              <>
                <span className="text-[28px] font-medium leading-none tabular-nums text-white/90">
                  {data.stxBalance.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span className="ml-1.5 text-[14px] text-white/40">STX</span>
              </>
            ) : (
              <span className="text-[14px] text-white/30">Unavailable</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`https://explorer.hiro.so/address/${SPONSOR_ADDRESS}?chain=mainnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[11px] font-mono text-white/40 transition-colors hover:text-white/60"
            >
              {shortAddr(SPONSOR_ADDRESS)}
              <svg
                aria-hidden="true"
                className="size-2.5 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            </a>
          </div>
        </div>
      </div>

      {/* ─── Auto-refresh note ─── */}
      <p className="mt-6 text-[12px] text-white/25">
        Auto-refreshes every 30 seconds. Data sourced from{" "}
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
