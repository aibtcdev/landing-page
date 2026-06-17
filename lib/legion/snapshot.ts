/**
 * Assemble a full Legion snapshot from testnet, and read/write it in KV.
 *
 * The fan-out (treasury + gov + per-agent stake/balance + per-proposal
 * status/votes) runs server-side, ONCE per cron tick, and the result is stored
 * as a single KV blob. The dashboard endpoint reads that blob — so Hiro read
 * volume is fixed per refresh interval, independent of page traffic.
 *
 * Every read is wrapped so one failed call degrades to a partial snapshot
 * (recorded in `errors`) rather than throwing the whole build away.
 */

import { principalCV, uintCV } from "@stacks/transactions";
import { getTestnetTipHeight, legionReadOnly } from "./stacks";
import {
  GOV_CONTRACT,
  LEGION_AGENTS,
  LEGION_SNAPSHOT_KV_KEY,
  legionLabelFor,
  SBTC_TOKEN,
  TREASURY_CONTRACT,
} from "./constants";
import type {
  LegionMember,
  LegionProposal,
  LegionSnapshot,
  LegionVote,
} from "./types";
import type { Logger } from "../logging";

/** Coerce a Clarity uint string (or anything) to a finite number, defaulting 0. */
function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function get<T = unknown>(obj: unknown, key: string): T | undefined {
  if (obj && typeof obj === "object") {
    return (obj as Record<string, unknown>)[key] as T | undefined;
  }
  return undefined;
}

/**
 * Build a fresh snapshot. Pass the previous snapshot (`prev`) to skip re-reading
 * terminal data: a proposal with `concluded == true` can never change on-chain
 * (nor can its vote records), so it's carried forward verbatim and costs zero
 * Hiro reads. Only in-flight proposals — and the always-changing treasury /
 * stake / balance reads — are fetched each tick.
 */
export async function buildLegionSnapshot(
  logger?: Logger,
  prev?: LegionSnapshot | null,
): Promise<LegionSnapshot> {
  const errors: string[] = [];

  /** Run a read, recording failures and returning a fallback instead of throwing. */
  async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const msg = `${label}: ${String(e)}`;
      errors.push(msg);
      logger?.warn?.("legion.read_failed", { label, error: String(e) });
      return fallback;
    }
  }

  // Top-level reads in parallel.
  const [
    blockHeight,
    balance,
    govWire,
    payoutWire,
    tokenWire,
    totalStakedRaw,
    proposalCountRaw,
  ] = await Promise.all([
    getTestnetTipHeight(logger),
    safe("treasury.get-balance", () => legionReadOnly(TREASURY_CONTRACT, "get-balance", [], logger), null),
    safe("treasury.get-gov", () => legionReadOnly(TREASURY_CONTRACT, "get-gov", [], logger), null),
    safe("treasury.get-payout", () => legionReadOnly(TREASURY_CONTRACT, "get-payout", [], logger), null),
    safe("treasury.get-token", () => legionReadOnly(TREASURY_CONTRACT, "get-token", [], logger), null),
    safe("gov.get-total-staked", () => legionReadOnly(GOV_CONTRACT, "get-total-staked", [], logger), null),
    safe("gov.get-proposal-count", () => legionReadOnly(GOV_CONTRACT, "get-proposal-count", [], logger), null),
  ]);

  const totalStaked = totalStakedRaw != null ? toNum(totalStakedRaw) : null;

  // Members — stake + wallet sBTC balance per agent, in parallel.
  const members: LegionMember[] = await Promise.all(
    LEGION_AGENTS.map(async (agent) => {
      const [stakeRaw, balRaw] = await Promise.all([
        safe(`gov.get-stake.${agent.label}`, () => legionReadOnly(GOV_CONTRACT, "get-stake", [principalCV(agent.address)], logger), null),
        safe(`sbtc.get-balance.${agent.label}`, () => legionReadOnly(SBTC_TOKEN, "get-balance", [principalCV(agent.address)], logger), null),
      ]);
      const stake = stakeRaw != null ? toNum(stakeRaw) : 0;
      return {
        label: agent.label,
        address: agent.address,
        stake,
        weightPct: totalStaked && totalStaked > 0 ? (stake / totalStaked) * 100 : 0,
        sbtcBalance: balRaw != null ? toNum(balRaw) : 0,
      } satisfies LegionMember;
    }),
  );
  members.sort((a, b) => b.stake - a.stake);

  // Proposals — newest first (id = count .. 1). Concluded proposals are terminal,
  // so reuse them from the previous snapshot instead of re-reading from Hiro.
  const concludedById = new Map<number, LegionProposal>();
  for (const p of prev?.proposals ?? []) {
    if (p.status.concluded) concludedById.set(p.id, p);
  }

  const proposalCount = proposalCountRaw != null ? toNum(proposalCountRaw) : 0;
  const ids = Array.from({ length: proposalCount }, (_, i) => proposalCount - i);

  const proposals = (
    await Promise.all(
      ids.map((id) => {
        const cached = concludedById.get(id);
        return cached ? Promise.resolve(cached) : buildProposal(id, safe, logger);
      }),
    )
  ).filter((p): p is LegionProposal => p !== null);

  logger?.debug?.("legion.proposals_built", {
    total: proposals.length,
    reused: ids.filter((id) => concludedById.has(id)).length,
  });

  return {
    updatedAt: Date.now(),
    blockHeight,
    treasury: {
      balance: balance != null ? toNum(balance) : null,
      govWired: govWire != null,
      payoutWired: payoutWire != null,
      tokenWired: tokenWire != null,
    },
    totalStaked,
    members,
    proposals,
    errors,
  };
}

async function buildProposal(
  id: number,
  safe: <T>(label: string, fn: () => Promise<T>, fallback: T) => Promise<T>,
  logger?: Logger,
): Promise<LegionProposal | null> {
  const [prop, status] = await Promise.all([
    safe(`gov.get-proposal.${id}`, () => legionReadOnly(GOV_CONTRACT, "get-proposal", [uintCV(id)], logger), null),
    safe(`gov.get-proposal-status.${id}`, () => legionReadOnly(GOV_CONTRACT, "get-proposal-status", [uintCV(id)], logger), null),
  ]);

  if (!prop || !status) return null;

  // Per-agent vote records (optional tuple {vote, amount} or null).
  const votes: LegionVote[] = await Promise.all(
    LEGION_AGENTS.map(async (agent) => {
      const rec = await safe(
        `gov.get-vote-record.${id}.${agent.label}`,
        () => legionReadOnly(GOV_CONTRACT, "get-vote-record", [uintCV(id), principalCV(agent.address)], logger),
        null,
      );
      const voted = rec != null;
      return {
        label: agent.label,
        address: agent.address,
        voted,
        vote: voted ? Boolean(get(rec, "vote")) : null,
        amount: voted ? toNum(get(rec, "amount")) : 0,
      } satisfies LegionVote;
    }),
  );

  const proposer = String(get(prop, "proposer") ?? "");
  const recipient = String(get(prop, "recipient") ?? "");

  return {
    id,
    proposer,
    proposerLabel: legionLabelFor(proposer),
    desc: String(get(prop, "desc") ?? ""),
    recipient,
    recipientLabel: legionLabelFor(recipient),
    amount: toNum(get(prop, "amount")),
    status: {
      createdBtc: toNum(get(status, "createdBtc")),
      voteStart: toNum(get(status, "voteStart")),
      voteEnd: toNum(get(status, "voteEnd")),
      execStart: toNum(get(status, "execStart")),
      execEnd: toNum(get(status, "execEnd")),
      yesWeight: toNum(get(status, "yesWeight")),
      noWeight: toNum(get(status, "noWeight")),
      vetoWeight: toNum(get(status, "vetoWeight")),
      totalStakedSnapshot: toNum(get(status, "totalStakedSnapshot")),
      voterCount: toNum(get(status, "voterCount")),
      metQuorum: Boolean(get(status, "metQuorum")),
      metThreshold: Boolean(get(status, "metThreshold")),
      vetoMetQuorum: Boolean(get(status, "vetoMetQuorum")),
      vetoActivated: Boolean(get(status, "vetoActivated")),
      concluded: Boolean(get(status, "concluded")),
      executed: Boolean(get(status, "executed")),
    },
    votes,
  };
}

// ─────────────────────────── KV persistence ───────────────────────────

export async function readLegionSnapshot(
  kv: KVNamespace,
): Promise<LegionSnapshot | null> {
  const raw = await kv.get(LEGION_SNAPSHOT_KV_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LegionSnapshot;
  } catch {
    return null;
  }
}

export async function writeLegionSnapshot(
  kv: KVNamespace,
  snapshot: LegionSnapshot,
): Promise<void> {
  await kv.put(LEGION_SNAPSHOT_KV_KEY, JSON.stringify(snapshot));
}
