/**
 * Live chain reads for the legions page: the burn tip, the market, and each
 * legion's params, vault, settlement and member weights.
 *
 * All best-effort. A failed read comes back null and the page still renders
 * every stored proposal from the folded events; it only loses the live figures.
 * `get-params` is immutable per deployment, so it is read once per isolate.
 */

import { buildHiroHeaders } from "../stacks-api-fetch";
import { asNumber, decodeClarityHex, principalArg, toPlain, uintArg, type Plain } from "./clarity";
import { ClarityType } from "@stacks/transactions";
import { HIRO_API, LEGION_DEPLOYER, MARKET_CONTRACT, type LegionParams } from "./constants";

const READ_TIMEOUT_MS = 5_000;

/**
 * Call a read-only function. Returns the decoded value (an optional or `ok`
 * unwrapped), or undefined when the call failed or returned `err`. Undefined is
 * "we could not find out", as distinct from a legitimate `none`.
 */
export async function callRead(
  contractId: string,
  fn: string,
  args: readonly string[],
  apiKey?: string
): Promise<Plain | undefined> {
  const dot = contractId.indexOf(".");
  if (dot < 0) return undefined;
  const address = contractId.slice(0, dot);
  const name = contractId.slice(dot + 1);
  try {
    const res = await fetch(`${HIRO_API}/v2/contracts/call-read/${address}/${name}/${fn}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...buildHiroHeaders(apiKey) },
      body: JSON.stringify({ sender: LEGION_DEPLOYER, arguments: args }),
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as { okay?: boolean; result?: string };
    if (!json.okay || !json.result) return undefined;
    const cv = decodeClarityHex(json.result);
    if (!cv || cv.type === ClarityType.ResponseErr) return undefined;
    return toPlain(cv);
  } catch {
    return undefined;
  }
}

function tuple(v: Plain | undefined): Record<string, Plain> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Plain>) : null;
}

export interface BurnTip {
  height: number | null;
  /** Unix seconds of that block: the anchor every countdown is measured from. */
  time: number | null;
}

/** The Bitcoin tip, height and timestamp, in one read. */
export async function readBurnTip(apiKey?: string): Promise<BurnTip> {
  try {
    const res = await fetch(`${HIRO_API}/extended/v2/burn-blocks?limit=1`, {
      headers: buildHiroHeaders(apiKey),
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    if (!res.ok) return { height: null, time: null };
    const json = (await res.json()) as {
      results?: { burn_block_height?: number; burn_block_time?: number }[];
    };
    const b = json.results?.[0];
    return { height: b?.burn_block_height ?? null, time: b?.burn_block_time ?? null };
  } catch {
    return { height: null, time: null };
  }
}

const PARAMS_CACHE = new Map<string, LegionParams>();

export async function readParams(contractId: string, apiKey?: string): Promise<LegionParams | null> {
  const cached = PARAMS_CACHE.get(contractId);
  if (cached) return cached;
  const t = tuple(await callRead(contractId, "get-params", [], apiKey));
  if (!t) return null;
  const n = (k: string) => asNumber(t[k]);
  const voteWindow = n("voteWindow");
  const concludeWindow = n("concludeWindow");
  // The two windows the phase arithmetic cannot run without. Anything short of
  // them is not a params read worth caching.
  if (voteWindow == null || concludeWindow == null) return null;
  const params: LegionParams = {
    minPosition: n("minPosition") ?? 1_000,
    payout: n("payout") ?? 3_000,
    minVoters: n("minVoters") ?? 2,
    proposerCooldown: n("proposerCooldown") ?? 144,
    votingThreshold: n("votingThreshold") ?? 66,
    voteDelay: n("voteDelay") ?? 2,
    voteWindow,
    concludeWindow,
    globalProposeInterval: n("globalProposeInterval") ?? 6,
  };
  PARAMS_CACHE.set(contractId, params);
  return params;
}

export interface MarketSnapshot {
  title: string;
  opened: boolean;
  closeHeight: number | null;
  createdAt: number | null;
  /** 0 open, 1 resolved Bonded, 2 resolved Idle. */
  status: number | null;
  /** sBTC held by the market, in sats. */
  vault: number | null;
  idleCirc: number | null;
  bondedCirc: number | null;
}

export async function readMarket(apiKey?: string): Promise<MarketSnapshot | null> {
  const t = tuple(await callRead(MARKET_CONTRACT, "get-market", [], apiKey));
  if (!t) return null;
  return {
    title: typeof t.title === "string" ? t.title : "",
    opened: t.opened === true,
    closeHeight: asNumber(t["close-height"]),
    createdAt: asNumber(t["created-at"]),
    status: asNumber(t.status),
    vault: asNumber(t.vault),
    idleCirc: asNumber(t["idle-circ"]),
    bondedCirc: asNumber(t["bonded-circ"]),
  };
}

/** The legion's own share position: what its pot still holds. */
export async function readVault(contractId: string, apiKey?: string): Promise<number | null> {
  return asNumber(await callRead(contractId, "get-vault", [], apiKey));
}

export interface Settlement {
  redeemed: boolean;
  redeemedSats: number;
  paidSats: number;
  unpaidSats: number;
  totalCredits: number;
  won: boolean;
}

export async function readSettlement(contractId: string, apiKey?: string): Promise<Settlement | null> {
  const t = tuple(await callRead(contractId, "get-settlement", [], apiKey));
  if (!t) return null;
  return {
    redeemed: t.redeemed === true,
    redeemedSats: asNumber(t.redeemedSats) ?? 0,
    paidSats: asNumber(t.paidSats) ?? 0,
    unpaidSats: asNumber(t.unpaidSats) ?? 0,
    totalCredits: asNumber(t.totalCredits) ?? 0,
    won: t.won === true,
  };
}

/** A principal's live voting weight: its shares on this legion's side. */
export async function readWeight(contractId: string, who: string, apiKey?: string): Promise<number | null> {
  return asNumber(await callRead(contractId, "get-weight", [principalArg(who)], apiKey));
}

export interface ProposalMeta {
  title: string;
  description: string;
  link: string;
}

/**
 * The argument a proposal was filed with. `propose` prints the link and title
 * but not the description, so the chainhook route reads this once per new
 * proposal and stores the description beside the event.
 */
export async function readProposalMeta(
  contractId: string,
  proposalId: number,
  apiKey?: string
): Promise<ProposalMeta | null> {
  const t = tuple(await callRead(contractId, "get-proposal-meta", [uintArg(proposalId)], apiKey));
  if (!t) return null;
  return {
    title: typeof t.title === "string" ? t.title : "",
    description: typeof t.description === "string" ? t.description : "",
    link: typeof t.link === "string" ? t.link : "",
  };
}
