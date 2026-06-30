/**
 * `legion-engage` reads — the v1 optional engagement stake.
 *
 * Staking is OPTIONAL and never required to earn; it only buys ranking (the
 * gateway routes higher-staked providers first, see inference `rankByStake`).
 * Every read is best-effort: a Legion whose owner never deployed an engage
 * contract (most of them) degrades to stake 0 / null, never an error.
 */

import { principalCV } from "@stacks/transactions";
import { legionReadOnly } from "./stacks";
import { toNum } from "./format";
import type { Logger } from "../logging";

/** A provider's optional engagement stake (sats), or 0 if unstaked/unreadable. */
export async function getStake(
  engageContract: string,
  address: string,
  apiKey?: string,
  logger?: Logger,
): Promise<number> {
  try {
    const raw = await legionReadOnly(
      engageContract,
      "get-stake",
      [principalCV(address)],
      apiKey,
      logger,
    );
    return raw != null ? toNum(raw) : 0;
  } catch {
    return 0;
  }
}

/** Minimum stake to join `legion-engage` (sats), or null on read failure. */
export async function getMinStake(
  engageContract: string,
  apiKey?: string,
  logger?: Logger,
): Promise<number | null> {
  try {
    const raw = await legionReadOnly(engageContract, "get-min-stake", [], apiKey, logger);
    return raw != null ? toNum(raw) : null;
  } catch {
    return null;
  }
}

/** Total sBTC staked across all members (sats), or null on read failure. */
export async function getTotalStaked(
  engageContract: string,
  apiKey?: string,
  logger?: Logger,
): Promise<number | null> {
  try {
    const raw = await legionReadOnly(engageContract, "get-total-staked", [], apiKey, logger);
    return raw != null ? toNum(raw) : null;
  } catch {
    return null;
  }
}
