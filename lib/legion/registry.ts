/**
 * Read the on-chain Legion **registry** — the directory that lists every Legion.
 *
 * `legion-registry` exposes `get-count` → uint and `get-legion(id)` →
 * `(optional { owner, kind, treasury, gov, fees, model, uri, active })`. We
 * normalize each entry into a `LegionEntry` and derive the per-kind third
 * contract (provider Legions: `{owner}.legion-providers`, by convention — the
 * registry doesn't store it).
 *
 * The known demand Legion (lib/legion/constants.ts) is not in the registry yet,
 * so `listLegions` prepends it as a `source: "fallback"` entry, deduped by
 * treasury contract in case it later gets registered.
 */

import { uintCV } from "@stacks/transactions";
import { legionReadOnly } from "./stacks";
import {
  DEMAND_LEGION_ID,
  FEES_CONTRACT,
  GOV_CONTRACT,
  LEGION_DEPLOYER,
  type LegionKind,
  legionProvidersContract,
  REGISTRY_CONTRACT,
  TREASURY_CONTRACT,
} from "./constants";
import type { LegionEntry, LegionSummary } from "./types";
import type { Logger } from "../logging";

/** Cap how many registry ids we walk per build — a sane upper bound. */
const MAX_LEGIONS = 100;

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function normalizeKind(raw: unknown): LegionKind {
  return str(raw).trim() === "provider" ? "provider" : "demand";
}

/** The known demand Legion as a fallback entry (it predates the registry). */
export function demandFallbackEntry(): LegionEntry {
  return {
    id: DEMAND_LEGION_ID,
    kind: "demand",
    owner: LEGION_DEPLOYER,
    treasury: TREASURY_CONTRACT,
    gov: GOV_CONTRACT,
    fees: FEES_CONTRACT,
    providers: null,
    model: "",
    uri: "AIBTC Demand Legion",
    active: true,
    source: "fallback",
  };
}

/**
 * Reconstruct a full `LegionEntry` from a cached `LegionSummary`. The summary
 * (in the registry-index snapshot) omits the treasury/gov/fees/providers
 * contract ids, but all four follow the `{owner}.legion-*` convention, so the
 * detail page can render without a fresh Hiro round-trip.
 */
export function entryFromSummary(summary: LegionSummary): LegionEntry {
  // Prefer the explicit contract ids carried on the summary (per-model legions
  // use suffixed names under one owner). Fall back to the `{owner}.legion-*`
  // convention for back-compat with summaries written before those fields.
  return {
    id: summary.id,
    kind: summary.kind,
    owner: summary.owner,
    treasury: summary.treasury || `${summary.owner}.legion-treasury`,
    gov: summary.gov ?? (summary.kind === "demand" ? `${summary.owner}.legion-gov` : null),
    fees: summary.fees ?? `${summary.owner}.legion-fees`,
    providers: summary.kind === "provider" ? legionProvidersContract(summary.owner) : null,
    model: summary.model,
    uri: summary.uri,
    active: summary.active,
    source: summary.source,
  };
}

/** Map a decoded registry tuple to a normalized `LegionEntry`, or null. */
function parseRegistryEntry(id: number, raw: unknown): LegionEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const owner = str(t.owner);
  if (!owner) return null;
  const kind = normalizeKind(t.kind);
  return {
    id: String(id),
    kind,
    owner,
    // Use the registry's EXPLICIT contract ids — per-model legions are deployed
    // under one owner with suffixed names (legion-{treasury,gov,fees}-<model>),
    // so the `{owner}.legion-*` convention no longer holds. gov is honored for
    // every kind: a provider legion can be governed (stake -> propose/vote).
    treasury: str(t.treasury) || `${owner}.legion-treasury`,
    gov: str(t.gov) || (kind === "demand" ? `${owner}.legion-gov` : null),
    fees: str(t.fees) || null,
    providers: kind === "provider" ? legionProvidersContract(owner) : null,
    model: str(t.model),
    uri: str(t.uri),
    active: Boolean(t.active),
    source: "registry",
  };
}

/** Number of Legions registered on-chain (0 if the read fails). */
async function getCount(apiKey?: string, logger?: Logger): Promise<number> {
  try {
    const raw = await legionReadOnly(REGISTRY_CONTRACT, "get-count", [], apiKey, logger);
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, MAX_LEGIONS) : 0;
  } catch (e) {
    logger?.warn?.("legion.registry_count_failed", { error: String(e) });
    return 0;
  }
}

/** A single registry entry by numeric id, or null. */
async function getRegistryLegion(
  id: number,
  apiKey?: string,
  logger?: Logger,
): Promise<LegionEntry | null> {
  try {
    const raw = await legionReadOnly(
      REGISTRY_CONTRACT,
      "get-legion",
      [uintCV(id)],
      apiKey,
      logger,
    );
    return parseRegistryEntry(id, raw);
  } catch (e) {
    logger?.warn?.("legion.registry_get_failed", { id, error: String(e) });
    return null;
  }
}

/**
 * All Legions: the fallback demand entry first, then every active+inactive
 * registry entry (1..count). Deduped by treasury so a later-registered demand
 * Legion doesn't appear twice.
 */
export async function listLegions(
  apiKey?: string,
  logger?: Logger,
): Promise<LegionEntry[]> {
  const count = await getCount(apiKey, logger);
  const ids = Array.from({ length: count }, (_, i) => i + 1);
  const fetched = await Promise.all(ids.map((id) => getRegistryLegion(id, apiKey, logger)));
  const registryEntries = fetched.filter((e): e is LegionEntry => e !== null);

  const fallback = demandFallbackEntry();
  const haveDemandInRegistry = registryEntries.some(
    (e) => e.treasury === fallback.treasury,
  );
  return haveDemandInRegistry ? registryEntries : [fallback, ...registryEntries];
}

/** One Legion by id. `"demand"` → the fallback; numeric → the registry. */
export async function getLegion(
  id: string,
  apiKey?: string,
  logger?: Logger,
): Promise<LegionEntry | null> {
  if (id === DEMAND_LEGION_ID) return demandFallbackEntry();
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId < 1) return null;
  return getRegistryLegion(numId, apiKey, logger);
}
