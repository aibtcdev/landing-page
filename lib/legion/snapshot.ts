/**
 * Assemble a full Legion snapshot from testnet.
 *
 * Membership is OPEN — anyone who stakes can vote or propose — so the member
 * and voter sets are discovered from on-chain history (the gov contract's
 * `stake` / `vote` calls), never a hardcoded roster. The fan-out is persisted
 * to D1 by the cron and read behind caches.default, so Hiro volume is bounded.
 *
 * Guards: an authenticated Hiro key (a Worker shares its colo egress IP) and a
 * concurrency limiter. Every read degrades to a partial snapshot (`errors`)
 * rather than throwing. Concluded proposals are terminal, so they're carried
 * forward from `prev` and cost zero reads.
 */

import { type ClarityValue, principalCV, uintCV } from "@stacks/transactions";
import {
  type ContractTx,
  getContractTransactions,
  getTestnetTipHeight,
  legionReadOnly,
  parseUintRepr,
} from "./stacks";
import { GOV_CONTRACT, SBTC_TOKEN, TREASURY_CONTRACT } from "./constants";
import type {
  LegionMember,
  LegionProposal,
  LegionSnapshot,
  LegionVote,
} from "./types";
import type { Logger } from "../logging";

/** Max concurrent Hiro reads during a build. Keeps the fan-out from bursting. */
const LEGION_READ_CONCURRENCY = 6;
/** How far back through gov history to discover members/voters. */
const GOV_HISTORY_CAP = 500;

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

type ReadFn = <T>(label: string, task: () => Promise<unknown>, fallback: T) => Promise<T>;
type CallFn = (contract: string, fn: string, args?: ClarityValue[]) => Promise<unknown>;
/** proposalId → (voter → { vote, txid }), newest vote per voter. */
type VotesByProposal = Map<number, Map<string, { vote: boolean; txid: string }>>;

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

  const call: CallFn = (contract, fn, args = []) =>
    legionReadOnly(contract, fn, args, apiKey, logger);

  // Top-level reads.
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

  // Gov history drives BOTH member discovery (who staked) and voter discovery
  // (who voted, with txid). One fetch, reused below.
  const govTxs = await read(
    "gov.tx-history",
    () => getContractTransactions(GOV_CONTRACT, apiKey, logger, GOV_HISTORY_CAP),
    [] as ContractTx[],
  );

  // Candidate members = every distinct principal that has interacted with gov.
  // We confirm each by reading its current stake and keep only active stakers.
  const candidates = Array.from(
    new Set(govTxs.map((t) => t.sender).filter(Boolean)),
  );
  const members: LegionMember[] = (
    await Promise.all(
      candidates.map(async (address) => {
        const [stakeRaw, balRaw] = await Promise.all([
          read(`gov.get-stake.${address}`, () => call(GOV_CONTRACT, "get-stake", [principalCV(address)]), null),
          read(`sbtc.get-balance.${address}`, () => call(SBTC_TOKEN, "get-balance", [principalCV(address)]), null),
        ]);
        const stake = stakeRaw != null ? toNum(stakeRaw) : 0;
        return {
          address,
          stake,
          weightPct: totalStaked && totalStaked > 0 ? (stake / totalStaked) * 100 : 0,
          sbtcBalance: balRaw != null ? toNum(balRaw) : 0,
        } satisfies LegionMember;
      }),
    )
  )
    .filter((m) => m.stake > 0)
    .sort((a, b) => b.stake - a.stake);

  // Votes per proposal, derived from `vote` txs (newest-first → keep latest).
  const votesByProposal: VotesByProposal = new Map();
  for (const tx of govTxs) {
    if (tx.functionName !== "vote") continue;
    const pid = parseUintRepr(tx.argReprs[0]);
    if (pid == null) continue;
    let byVoter = votesByProposal.get(pid);
    if (!byVoter) {
      byVoter = new Map();
      votesByProposal.set(pid, byVoter);
    }
    if (!byVoter.has(tx.sender)) {
      byVoter.set(tx.sender, { vote: tx.argReprs[1] === "true", txid: tx.txid });
    }
  }

  // Proposals — newest first. Concluded ones are terminal (reuse verbatim); for
  // the rest, prefer a fresh read but fall back to the prior snapshot's copy if
  // this build's reads failed (e.g. transient 429), so a partial build never
  // wipes good data — the snapshot only ever improves.
  const prevById = new Map<number, LegionProposal>();
  for (const p of prev?.proposals ?? []) prevById.set(p.id, p);

  const proposalCount =
    proposalCountRaw != null ? toNum(proposalCountRaw) : (prev?.proposals.length ?? 0);
  const ids = Array.from({ length: proposalCount }, (_, i) => proposalCount - i);

  const proposals = (
    await Promise.all(
      ids.map(async (id) => {
        const prior = prevById.get(id);
        if (prior?.status.concluded) return prior; // terminal — never re-read
        const built = await buildProposal(id, read, call, votesByProposal.get(id) ?? new Map());
        return built ?? prior ?? null; // fall back to prior on read failure
      }),
    )
  ).filter((p): p is LegionProposal => p !== null);

  logger?.debug?.("legion.snapshot_built", {
    members: members.length,
    proposals: proposals.length,
    reused: ids.filter((id) => prevById.get(id)?.status.concluded).length,
    errors: errors.length,
  });

  // Fall back to the prior snapshot for any top-level read that failed this
  // build, so transient 429s never blank out good data.
  return {
    updatedAt: Date.now(),
    blockHeight: blockHeight ?? prev?.blockHeight ?? null,
    treasury: {
      balance: balance != null ? toNum(balance) : (prev?.treasury.balance ?? null),
      govWired: govWire != null ? true : (prev?.treasury.govWired ?? false),
      payoutWired: payoutWire != null ? true : (prev?.treasury.payoutWired ?? false),
      tokenWired: tokenWire != null ? true : (prev?.treasury.tokenWired ?? false),
    },
    totalStaked: totalStaked ?? prev?.totalStaked ?? null,
    members: members.length > 0 ? members : (prev?.members ?? []),
    proposals,
    errors,
  };
}

async function buildProposal(
  id: number,
  read: ReadFn,
  call: CallFn,
  voters: Map<string, { vote: boolean; txid: string }>,
): Promise<LegionProposal | null> {
  const [prop, status] = await Promise.all([
    read(`gov.get-proposal.${id}`, () => call(GOV_CONTRACT, "get-proposal", [uintCV(id)]), null),
    read(`gov.get-proposal-status.${id}`, () => call(GOV_CONTRACT, "get-proposal-status", [uintCV(id)]), null),
  ]);

  if (!prop || !status) return null;

  // The voters are known from tx history; read each vote record only for the
  // committed weight (amount). Bounded by the actual voter count.
  const votes: LegionVote[] = (
    await Promise.all(
      Array.from(voters.entries()).map(async ([address, v]) => {
        const rec = await read(
          `gov.get-vote-record.${id}.${address}`,
          () => call(GOV_CONTRACT, "get-vote-record", [uintCV(id), principalCV(address)]),
          null,
        );
        return {
          address,
          vote: v.vote,
          amount: rec != null ? toNum(get(rec, "amount")) : 0,
          txid: v.txid,
        } satisfies LegionVote;
      }),
    )
  ).sort((a, b) => b.amount - a.amount);

  return {
    id,
    proposer: String(get(prop, "proposer") ?? ""),
    desc: String(get(prop, "desc") ?? ""),
    recipient: String(get(prop, "recipient") ?? ""),
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
