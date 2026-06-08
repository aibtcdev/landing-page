/**
 * Hiro ingestion (issue #978, Phase 1).
 *
 * Uses `/extended/v1/address/{principal}/transactions_with_transfers`, which
 * returns each tx WITH its stx + ft transfers inline — so one call per page
 * yields every inbound transfer with sender/amount/asset, no per-tx detail
 * fetch and no memo parsing. That roughly halves Hiro calls vs the
 * list-then-fetch-each-tx pattern.
 */

import { stacksApiFetch, buildHiroHeaders } from "../stacks-api-fetch";
import { STACKS_API_BASE } from "../identity/constants";
import { assetInfoForFt, STX_ASSET_INFO, type AssetInfo } from "./assets";
import type { InboundTransfer } from "./types";
import type { Logger } from "../logging";

interface HiroTransfer {
  amount?: string;
  sender?: string;
  recipient?: string;
  asset_identifier?: string; // ft transfers only
}

interface HiroTxWithTransfers {
  tx?: {
    tx_id?: string;
    tx_status?: string;
    block_height?: number;
    burn_block_time?: number;
    is_unanchored?: boolean;
  };
  stx_transfers?: HiroTransfer[];
  ft_transfers?: HiroTransfer[];
}

export interface TransfersPage {
  results: HiroTxWithTransfers[];
  total: number;
  /** True when this is the last page (results < limit or end reached). */
  exhausted: boolean;
}

/** Fetch one page of an address's transactions-with-transfers. Returns null on
 *  a failed request (caller treats as "no progress this tick"). */
export async function fetchTransfersPage(
  env: { HIRO_API_KEY?: string },
  stxAddress: string,
  offset: number,
  limit: number,
  logger?: Logger
): Promise<TransfersPage | null> {
  const url =
    `${STACKS_API_BASE}/extended/v1/address/${encodeURIComponent(stxAddress)}` +
    `/transactions_with_transfers?limit=${limit}&offset=${offset}`;
  let res: Response;
  try {
    res = await stacksApiFetch(
      url,
      { method: "GET", headers: buildHiroHeaders(env.HIRO_API_KEY) },
      { logger }
    );
  } catch (err) {
    logger?.warn("earnings.hiro_fetch_threw", { stxAddress, offset, error: String(err) });
    return null;
  }
  if (!res.ok) {
    logger?.warn("earnings.hiro_page_failed", { stxAddress, offset, status: res.status });
    return null;
  }
  const body = (await res.json()) as {
    total?: number;
    results?: HiroTxWithTransfers[];
  };
  const results = body.results ?? [];
  const total = typeof body.total === "number" ? body.total : 0;
  return {
    results,
    total,
    exhausted: results.length < limit || offset + results.length >= total,
  };
}

function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n;
}

function makeTransfer(
  txId: string,
  eventIndex: number,
  sender: string,
  recipient: string,
  info: AssetInfo,
  amountRaw: number,
  blockHeight: number | null,
  blockTime: number
): InboundTransfer {
  return {
    txId,
    eventIndex,
    senderStx: sender,
    recipientAgentStx: recipient,
    asset: info.asset,
    amountRaw,
    stxBlockHeight: blockHeight,
    blockTime,
  };
}

/**
 * Extract the inbound (recipient = agent, sender ≠ agent) sBTC / STX / aeUSDC
 * transfers from one confirmed tx. `event_index` is the position within the
 * combined [stx_transfers…, ft_transfers…] list, so it's stable across re-runs
 * (the idempotency key is (tx_id, event_index)).
 */
export function extractInboundTransfers(
  result: HiroTxWithTransfers,
  agentStx: string
): InboundTransfer[] {
  const tx = result.tx;
  if (!tx || tx.tx_id == null) return [];
  if (tx.tx_status !== "success") return [];
  if (tx.is_unanchored === true) return []; // microblock — wait for anchor
  const blockTime = typeof tx.burn_block_time === "number" ? tx.burn_block_time : 0;
  if (blockTime <= 0) return [];
  const blockHeight = typeof tx.block_height === "number" ? tx.block_height : null;

  const out: InboundTransfer[] = [];
  let idx = 0;

  for (const t of result.stx_transfers ?? []) {
    const amt = parseAmount(t.amount);
    if (t.recipient === agentStx && t.sender && t.sender !== agentStx && amt && amt > 0) {
      out.push(makeTransfer(tx.tx_id, idx, t.sender, agentStx, STX_ASSET_INFO, amt, blockHeight, blockTime));
    }
    idx++;
  }

  for (const t of result.ft_transfers ?? []) {
    const info = t.asset_identifier ? assetInfoForFt(t.asset_identifier) : null;
    const amt = parseAmount(t.amount);
    if (info && t.recipient === agentStx && t.sender && t.sender !== agentStx && amt && amt > 0) {
      out.push(makeTransfer(tx.tx_id, idx, t.sender, agentStx, info, amt, blockHeight, blockTime));
    }
    idx++;
  }

  return out;
}

/** Highest stx block height among a page's successful txs (for the HWM). */
export function maxBlockHeight(results: HiroTxWithTransfers[]): number {
  let max = 0;
  for (const r of results) {
    const h = r.tx?.block_height;
    if (typeof h === "number" && h > max) max = h;
  }
  return max;
}
