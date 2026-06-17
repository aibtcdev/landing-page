/**
 * Assemble a full Legion snapshot from testnet.
 *
 * The fan-out (treasury + gov + per-agent stake/balance + per-proposal
 * status/votes) runs server-side and is persisted to D1 (lib/legion/d1.ts) by
 * the cron; the dashboard reads that row behind caches.default. So Hiro read
 * volume is bounded, not per page-view.
 *
 * Two guards keep the fan-out from breaking under load:
 *  - an authenticated Hiro key (a Worker shares its colo egress IP, so
 *    unauthenticated bursts can be throttled), and
 *  - a concurrency limiter so we never have more than N reads in flight.
 *
 * Every read degrades to a partial snapshot (recorded in `errors`) instead of
 * throwing the whole build away. Concluded proposals are terminal on-chain, so
 * they're carried forward from `prev` and cost zero reads.
 */

import { type ClarityValue, principalCV, uintCV } from "@stacks/transactions";
import { getTestnetTipHeight, legionReadOnly } from "./stacks";
import {
  GOV_CONTRACT,
  LEGION_AGENTS,
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

/** Max concurrent Hiro reads during a build. Keeps the fan-out from bursting. */
const LEGION_READ_CONCURRENCY = 6;

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

/** Minimal promise-concurrency limiter (pLimit-style). */
function createLimiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const release = () => {
    active--;
    queue.shift()?.();
  };
  return function limit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        task().then(resolve, reject).finally(release);
      };
      if (active < max) run();
      else queue.push(run);
    });
  };
}

/** A bounded, error-trapping read. Returns `fallback` on any failure. */
type ReadFn = <T>(label: string, task: () => Promise<unknown>, fallback: T) => Promise<T>;

/**
 * Build a fresh snapshot. Pass the previous snapshot (`prev`) to carry forward
 * terminal (`concluded`) proposals without re-reading them, and `apiKey` to
 * authenticate Hiro reads.
 */
export async function buildLegionSnapshot(
  logger?: Logger,
  prev?: LegionSnapshot | null,
  apiKey?: string,
): Promise<LegionSnapshot> {
  const errors: string[] = [];
  const limit = createLimiter(LEGION_READ_CONCURRENCY);

  const read: ReadFn = async (label, task, fallback) => {
    try {
      return (await limit(task)) as typeof fallback;
    } catch (e) {
      errors.push(`${label}: ${String(e)}`);
      logger?.warn?.("legion.read_failed", { label, error: String(e) });
      return fallback;
    }
  };

  /** A read-only contract call, authenticated + decoded. */
  const call = (contract: string, fn: string, args: ClarityValue[] = []) =>
    legionReadOnly(contract, fn, args, apiKey, logger);

  // Top-level reads (the limiter bounds true concurrency despite Promise.all).
  const [
    blockHeight,
    balance,
    govWire,
    payoutWire,
    tokenWire,
    totalStakedRaw,
    proposalCountRaw,
  ] = await Promise.all([
    read("info.tip", () => getTestnetTipHeight(apiKey, logger), null),
    read("treasury.get-balance", () => call(TREASURY_CONTRACT, "get-balance"), null),
    read("treasury.get-gov", () => call(TREASURY_CONTRACT, "get-gov"), null),
    read("treasury.get-payout", () => call(TREASURY_CONTRACT, "get-payout"), null),
    read("treasury.get-token", () => call(TREASURY_CONTRACT, "get-token"), null),
    read("gov.get-total-staked", () => call(GOV_CONTRACT, "get-total-staked"), null),
    read("gov.get-proposal-count", () => call(GOV_CONTRACT, "get-proposal-count"), null),
  ]);

  const totalStaked = totalStakedRaw != null ? toNum(totalStakedRaw) : null;

  // Members — stake + wallet sBTC balance per agent.
  const members: LegionMember[] = await Promise.all(
    LEGION_AGENTS.map(async (agent) => {
      const [stakeRaw, balRaw] = await Promise.all([
        read(`gov.get-stake.${agent.label}`, () => call(GOV_CONTRACT, "get-stake", [principalCV(agent.address)]), null),
        read(`sbtc.get-balance.${agent.label}`, () => call(SBTC_TOKEN, "get-balance", [principalCV(agent.address)]), null),
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

  // Proposals — newest first (id = count .. 1). Reuse concluded ones from prev.
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
        return cached ? Promise.resolve(cached) : buildProposal(id, read, call);
      }),
    )
  ).filter((p): p is LegionProposal => p !== null);

  logger?.debug?.("legion.proposals_built", {
    total: proposals.length,
    reused: ids.filter((id) => concludedById.has(id)).length,
    errors: errors.length,
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
  read: ReadFn,
  call: (contract: string, fn: string, args?: ClarityValue[]) => Promise<unknown>,
): Promise<LegionProposal | null> {
  const [prop, status] = await Promise.all([
    read(`gov.get-proposal.${id}`, () => call(GOV_CONTRACT, "get-proposal", [uintCV(id)]), null),
    read(`gov.get-proposal-status.${id}`, () => call(GOV_CONTRACT, "get-proposal-status", [uintCV(id)]), null),
  ]);

  if (!prop || !status) return null;

  // Per-agent vote records (optional tuple {vote, amount} or null).
  const votes: LegionVote[] = await Promise.all(
    LEGION_AGENTS.map(async (agent) => {
      const rec = await read(
        `gov.get-vote-record.${id}.${agent.label}`,
        () => call(GOV_CONTRACT, "get-vote-record", [uintCV(id), principalCV(agent.address)]),
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
