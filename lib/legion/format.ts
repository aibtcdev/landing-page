/**
 * Pure display helpers for the legions page. No DOM, no I/O. Ported from
 * news-legion (src/lib/format.ts), mainnet only.
 */

import { BURN_BLOCK_SECONDS } from "./constants";
import type { Phase, Reason, StatusBucket } from "./state";

export const EXPLORER = "https://explorer.hiro.so";

export function fmtInt(n: number | null | undefined): string {
  return n == null ? "-" : Number(n).toLocaleString("en-US");
}

export function fmtSats(n: number | null | undefined): string {
  return n == null ? "-" : `${Number(n).toLocaleString("en-US")} sats`;
}

export function fmtShares(n: number | null | undefined): string {
  return n == null ? "-" : `${Number(n).toLocaleString("en-US")} shares`;
}

export function shortAddr(a: string | null | undefined): string {
  if (!a) return "-";
  return a.length > 16 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/** Over a million, abbreviated, so a row of figures compares at a glance. */
export function fmtCompact(n: number | null | undefined): string {
  if (n == null) return "-";
  const v = Number(n);
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  return v.toLocaleString("en-US");
}

/** How long something took: `11 min`, `3 hr 20 min`, `2 days`. */
export function fmtSpan(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s} sec`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem ? `${h} hr ${rem} min` : `${h} hr`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}

/** Seconds → `02:14:31`, or `2d 04:11:09` once it runs past a day. */
export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  const days = Math.floor(s / 86_400);
  const hh = pad(Math.floor((s % 86_400) / 3_600));
  const mm = pad(Math.floor((s % 3_600) / 60));
  const ss = pad(s % 60);
  return days > 0 ? `${days}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}

/** Human countdown from a block delta. */
export function fmtBlocksLeft(blocks: number, secondsPerBlock = BURN_BLOCK_SECONDS): string {
  if (blocks <= 0) return "now";
  const secs = blocks * secondsPerBlock;
  if (secs < 90) return `~${Math.round(secs)}s`;
  const m = Math.round(secs / 60);
  if (m < 60) return `~${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) {
    const rem = m % 60;
    return rem ? `~${h}h ${rem}m` : `~${h}h`;
  }
  return `~${Math.round(h / 24)} days`;
}

export function txLink(txid: string): string {
  return `${EXPLORER}/txid/${txid}`;
}

export function contractLink(contractId: string): string {
  return `${EXPLORER}/txid/${encodeURIComponent(contractId)}`;
}

export function addrLink(address: string): string {
  return `${EXPLORER}/address/${encodeURIComponent(address)}`;
}

/**
 * A proposer-supplied link, or null if it is not something to render as one.
 * The string came from an unverified contract argument, so anything not plainly
 * http(s) (`javascript:`, `data:`, a relative path) is dropped, not guessed at.
 */
export function safeHref(link: string | null | undefined): string | null {
  if (!link) return null;
  const raw = link.trim();
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(candidate);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function linkHost(link: string | null | undefined): string | null {
  const href = safeHref(link);
  if (!href) return null;
  try {
    return new URL(href).host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export const BUCKET_LABEL: Record<StatusBucket, string> = {
  pending: "Pending",
  verified: "Passed",
  rejected: "Not approved",
};

export const PHASE_LABEL: Record<Phase, string> = {
  pending: "Voting opens soon",
  voting: "Voting open",
  concludable: "Awaiting conclude",
  expired: "Expired, unconcluded",
  passed: "Passed & paid",
  failed: "Rejected",
};

export const REASON_LABEL: Record<Reason, string> = {
  "": "",
  "paid-shares": "Paid in shares",
  credited: "Credited against the vault",
  "no-voters": "Too few yes voters",
  "voted-down": "Voted down",
  "not-holding": "Proposer sold below the floor",
  "pot-short": "Vault short",
  "not-concluded": "Never concluded",
};

export const OUTCOME_LABEL: Record<string, string> = {
  PASSED: "would pass",
  NO_VOTERS: "short of yes voters",
  VOTED_DOWN: "would be voted down",
  NOT_HOLDING: "proposer no longer holds the floor",
  POT_SHORT: "vault cannot cover the payout",
};
