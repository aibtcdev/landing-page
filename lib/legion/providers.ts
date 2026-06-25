/**
 * Provider-Legion reads. A provider Legion is a guild of inference operators:
 * each stakes a `bond` and serves a model, earning sBTC per call (the Legion's
 * treasury skims 8%). Governed by `legion-providers`, not `legion-gov`.
 *
 * Enumerating providers is the one hard part — the on-chain `Providers` map has
 * no "list all". We scan the contract's `register` print events to recover the
 * member set, dedupe, then read each member's current record (brief §3, option
 * (a): event-scan over a cron-tracked index, chosen for v1 because it needs no
 * extra storage).
 */

import { principalCV } from "@stacks/transactions";
import { getContractEvents, getTestnetTipHeight, legionReadOnly } from "./stacks";
import { get, toNum } from "./format";
import type { LegionEntry, ProviderRecord, ProviderSnapshot } from "./types";
import type { Logger } from "../logging";

const PROVIDER_EVENT_CAP = 300;

/** One provider's current record, or null if unregistered / read failed. */
export async function getProvider(
  providersContract: string,
  address: string,
  apiKey?: string,
  logger?: Logger,
): Promise<ProviderRecord | null> {
  const raw = await legionReadOnly(
    providersContract,
    "get-provider",
    [principalCV(address)],
    apiKey,
    logger,
  );
  if (!raw || typeof raw !== "object") return null;
  return {
    address,
    model: String(get(raw, "model") ?? ""),
    endpoint: String(get(raw, "endpoint") ?? ""),
    bond: toNum(get(raw, "bond")),
    active: Boolean(get(raw, "active")),
    jobsOk: toNum(get(raw, "jobs-ok")),
    jobsFail: toNum(get(raw, "jobs-fail")),
  };
}

/** Minimum bond (sats) to register as a provider, or null on read failure. */
export async function getMinBond(
  providersContract: string,
  apiKey?: string,
  logger?: Logger,
): Promise<number | null> {
  try {
    const raw = await legionReadOnly(providersContract, "get-min-bond", [], apiKey, logger);
    return raw != null ? toNum(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Distinct provider addresses that ever registered, recovered from the
 * contract's `register` print events (newest first, deduped).
 */
export async function listProviderAddresses(
  providersContract: string,
  apiKey?: string,
  logger?: Logger,
): Promise<string[]> {
  const events = await getContractEvents(providersContract, apiKey, logger, PROVIDER_EVENT_CAP);
  const seen = new Set<string>();
  for (const ev of events) {
    if (String(get(ev, "event")) !== "register") continue;
    const provider = get(ev, "provider");
    if (typeof provider === "string" && provider) seen.add(provider);
  }
  return Array.from(seen);
}

/**
 * Assemble a full provider-Legion snapshot: treasury balance, min bond, and
 * every registered provider's current record. Mirrors `buildLegionSnapshot`
 * (demand): every read degrades to a partial snapshot rather than throwing, and
 * a failed build falls back to `prev` so transient 429s never blank good data.
 */
export async function buildProviderSnapshot(
  entry: LegionEntry,
  prev?: ProviderSnapshot | null,
  apiKey?: string,
  logger?: Logger,
): Promise<ProviderSnapshot> {
  const errors: string[] = [];
  const providersContract = entry.providers ?? `${entry.owner}.legion-providers`;

  const read = async <T>(label: string, task: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await task();
    } catch (e) {
      errors.push(`${label}: ${String(e)}`);
      logger?.warn?.("legion.provider_read_failed", { label, error: String(e) });
      return fallback;
    }
  };

  const [blockHeight, balanceRaw, minBond, addresses] = await Promise.all([
    read("info.tip", () => getTestnetTipHeight(apiKey, logger), null),
    read(
      "treasury.get-balance",
      () => legionReadOnly(entry.treasury, "get-balance", [], apiKey, logger),
      null,
    ),
    read("providers.get-min-bond", () => getMinBond(providersContract, apiKey, logger), null),
    read(
      "providers.events",
      () => listProviderAddresses(providersContract, apiKey, logger),
      [] as string[],
    ),
  ]);

  const providers = (
    await Promise.all(
      addresses.map((addr) =>
        read(
          `providers.get-provider.${addr}`,
          () => getProvider(providersContract, addr, apiKey, logger),
          null,
        ),
      ),
    )
  )
    .filter((p): p is ProviderRecord => p !== null)
    .sort((a, b) => b.bond - a.bond);

  return {
    updatedAt: Date.now(),
    blockHeight: blockHeight ?? prev?.blockHeight ?? null,
    entry,
    treasuryBalance: balanceRaw != null ? toNum(balanceRaw) : (prev?.treasuryBalance ?? null),
    minBond: minBond ?? prev?.minBond ?? null,
    providers: providers.length > 0 ? providers : (prev?.providers ?? []),
    errors,
  };
}
