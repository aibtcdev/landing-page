/**
 * The public legions state, shared by `GET /api/legions` and the
 * server-rendered `/legions` page.
 *
 * Two layers with two lifetimes. The EVENTS are read from D1 on every request,
 * so a vote the chainhook just delivered shows on the next poll in every colo.
 * The CHAIN reads (burn tip, market, params, vaults, settlement, proposer
 * weights) are the Hiro-quota part, so they are edge-cached per colo for
 * LEGION_STATE_TTL_SECONDS and purged when a delivery lands. The response
 * itself is `no-store`: Cloudflare's zone Browser Cache TTL rewrites a
 * `max-age=0` to four hours, which pinned stale votes in the browser and CDN.
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { invalidateEdgeCache, withEdgeCache } from "../edge-cache";
import { createConsoleLogger } from "../logging";
import {
  readBurnTip,
  readMarket,
  readMarketPrincipals,
  readParams,
  readSettlement,
  readVault,
  readWeight,
  type BurnTip,
  type MarketSnapshot,
  type Settlement,
} from "./chain";
import {
  BURN_BLOCK_SECONDS,
  ELIGIBLE_READ_CONCURRENCY,
  FALLBACK_PARAMS,
  LEGIONS,
  LEGION_CONTRACTS,
  LEGION_SIDES,
  LEGION_STATE_TTL_SECONDS,
  MARKET_CONTRACT,
  MARKET_STATUS,
  MAX_ELIGIBLE_WEIGHT_READS,
  MAX_MARKET_EVENT_PAGES,
  MAX_MEMBER_WEIGHT_READS,
  type LegionParams,
  type LegionSide,
} from "./constants";
import { listLegionEvents } from "./d1";
import { foldSide, participantsOf, type SideFold } from "./state";
import type { EventRow } from "./chainhook";

const log = createConsoleLogger({ module: "legions" });

export interface MarketState {
  contract: string;
  title: string;
  /** 0 open, 1 resolved Bonded, 2 resolved Idle. Null when the read failed. */
  status: number | null;
  closeHeight: number | null;
  bondedCirc: number | null;
  idleCirc: number | null;
  /** Mirrors `is-market-tradeable`: open, and the tip not past close-height. */
  tradeable: boolean | null;
}

/**
 * Principals holding at least `minPosition` of this side right now, i.e. who
 * could vote today whether or not they have ever acted. `members` only lists
 * principals that have proposed or voted.
 */
export interface Eligibility {
  /** Null when the holder set could not be read. */
  count: number | null;
  minPosition: number;
  /** Principals whose balance was checked. */
  checked: number;
  /** False if the holder walk or the balance reads were cut short. */
  complete: boolean;
}

export interface SideState extends SideFold {
  side: LegionSide;
  contract: string;
  name: string;
  argues: "Yes" | "No";
  shareLabel: "Bonded" | "Idle";
  /** This deployment's `get-params`, or the source constants if that read failed. */
  rules: LegionParams;
  /** Shares left in the pot. */
  vault: number | null;
  winsLeft: number | null;
  /** Circulating shares on this side, less the vault. */
  votable: number | null;
  settlement: Settlement | null;
  eligible: Eligibility;
}

export interface LegionsState {
  /** Burn height: both contracts count Bitcoin blocks. */
  tip: number | null;
  /** Unix seconds of the tip block, the anchor every countdown counts toward. */
  tipTime: number | null;
  blockSeconds: number;
  generatedAt: number;
  market: MarketState | null;
  sides: Record<LegionSide, SideState>;
}

/** Everything read from Hiro, per side in LEGION_SIDES order. */
interface ChainSnapshot {
  tip: BurnTip;
  market: MarketSnapshot | null;
  params: (LegionParams | null)[];
  vaults: (number | null)[];
  settlements: (Settlement | null)[];
  /** Live proposer weights, by principal. */
  weights: Record<string, number>[];
  /** Live weight of every known holder, by principal, per side. Null when the holder walk failed. */
  holderWeights: (Record<string, number> | null)[];
  /** Per side: every candidate found and every balance read succeeded. */
  holdersComplete: boolean[];
}

const CHAIN_CACHE_KEY = "https://cache.aibtc.local/api/legions/chain";

/**
 * Live weights for proposers only. The one place the page needs a live
 * position is the "proposer still holds the floor" gate `conclude` re-checks;
 * voters' weights are fixed in their ballots.
 */
async function readWeights(
  events: readonly EventRow[],
  contract: string,
  apiKey?: string
): Promise<Record<string, number>> {
  const proposers = new Set(
    events
      .filter((e) => e.contract_id === contract && e.event === "propose")
      .map((e) => e.data.proposer)
  );
  const who = participantsOf(events, contract)
    .filter((w) => proposers.has(w))
    .slice(0, MAX_MEMBER_WEIGHT_READS);
  const read = await Promise.all(
    who.map(async (w) => [w, await readWeight(contract, w, apiKey)] as const)
  );
  const out: Record<string, number> = {};
  for (const [w, weight] of read) if (weight != null) out[w] = weight;
  return out;
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function mapPooled<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Live weight on each side for every principal that could hold a position:
 * everyone the market has printed, plus everyone who has acted in a legion.
 */
async function readHolderWeights(
  events: readonly EventRow[],
  apiKey?: string
): Promise<{ weights: (Record<string, number> | null)[]; complete: boolean[] }> {
  const market = await readMarketPrincipals(MAX_MARKET_EVENT_PAGES, apiKey);
  if (market.principals.length === 0 && !market.complete) {
    return { weights: LEGION_SIDES.map(() => null), complete: LEGION_SIDES.map(() => false) };
  }
  const candidates = [
    ...new Set([
      ...market.principals,
      ...LEGION_SIDES.flatMap((s) => participantsOf(events, LEGIONS[s].contract)),
    ]),
  ];
  const checked = candidates.slice(0, MAX_ELIGIBLE_WEIGHT_READS);
  const walkedAll = market.complete && checked.length === candidates.length;
  const perSide = await Promise.all(
    LEGION_SIDES.map(async (s) => {
      const read = await mapPooled(checked, ELIGIBLE_READ_CONCURRENCY, async (who) =>
        [who, await readWeight(LEGIONS[s].contract, who, apiKey)] as const
      );
      const out: Record<string, number> = {};
      for (const [who, w] of read) if (w != null) out[who] = w;
      return { out, complete: walkedAll && Object.keys(out).length === checked.length };
    })
  );
  return { weights: perSide.map((p) => p.out), complete: perSide.map((p) => p.complete) };
}

async function buildChainSnapshot(events: readonly EventRow[], apiKey?: string): Promise<ChainSnapshot> {
  const [tip, market, params, vaults, settlements, weights, holders] = await Promise.all([
    readBurnTip(apiKey),
    readMarket(apiKey),
    Promise.all(LEGION_SIDES.map((s) => readParams(LEGIONS[s].contract, apiKey))),
    Promise.all(LEGION_SIDES.map((s) => readVault(LEGIONS[s].contract, apiKey))),
    Promise.all(LEGION_SIDES.map((s) => readSettlement(LEGIONS[s].contract, apiKey))),
    Promise.all(LEGION_SIDES.map((s) => readWeights(events, LEGIONS[s].contract, apiKey))),
    readHolderWeights(events, apiKey),
  ]);
  return {
    tip,
    market,
    params,
    vaults,
    settlements,
    weights,
    holderWeights: holders.weights,
    holdersComplete: holders.complete,
  };
}

/**
 * The chain reads, edge-cached per colo. A snapshot that could not read the
 * tip is used but not cached, so a Hiro blip is not pinned for the whole TTL.
 */
async function readChainSnapshot(events: readonly EventRow[], apiKey?: string): Promise<ChainSnapshot> {
  const res = await withEdgeCache(CHAIN_CACHE_KEY, LEGION_STATE_TTL_SECONDS, async () => {
    const snap = await buildChainSnapshot(events, apiKey);
    const cacheControl =
      snap.tip.height == null ? "no-store" : `public, s-maxage=${LEGION_STATE_TTL_SECONDS}`;
    return Response.json(snap, { headers: { "Cache-Control": cacheControl } });
  });
  return (await res.json()) as ChainSnapshot;
}

/** Read the store fresh, the chain through its cache, and fold them together. */
export async function buildLegionsState(env: CloudflareEnv): Promise<LegionsState> {
  const db = env.DB as D1Database | undefined;
  const apiKey = env.HIRO_API_KEY;

  const events = db
    ? await listLegionEvents(db, LEGION_CONTRACTS).catch((err) => {
        log.error("legions.events_read_failed", { error: String(err) });
        return [] as EventRow[];
      })
    : [];
  const { tip, market, params, vaults, settlements, weights, holderWeights, holdersComplete } =
    await readChainSnapshot(events, apiKey);

  const tradeable =
    market?.status == null
      ? null
      : market.status !== MARKET_STATUS.OPEN
        ? false
        : tip.height != null && market.closeHeight != null
          ? tip.height <= market.closeHeight
          : null;

  const sides = {} as Record<LegionSide, SideState>;
  LEGION_SIDES.forEach((side, i) => {
    const cfg = LEGIONS[side];
    const rules = params[i] ?? FALLBACK_PARAMS;
    const vault = vaults[i];
    const settlement = settlements[i];
    const circ = market ? (cfg.marketSide === 1 ? market.bondedCirc : market.idleCirc) : null;
    const fold = foldSide(events, side, cfg.contract, {
      tip: tip.height,
      rules,
      weights: new Map(Object.entries(weights[i] ?? {})),
      vault,
      totalCredits: settlement?.totalCredits ?? null,
    });
    sides[side] = {
      ...fold,
      side,
      contract: cfg.contract,
      name: cfg.name,
      argues: cfg.argues,
      shareLabel: cfg.shareLabel,
      rules,
      vault,
      winsLeft: vault != null ? Math.floor(vault / rules.payout) : null,
      votable: circ != null && vault != null ? Math.max(0, circ - vault) : null,
      settlement,
      eligible: eligibilityOf(holderWeights?.[i] ?? null, rules.minPosition, holdersComplete?.[i] ?? false),
    };
  });

  return {
    tip: tip.height,
    tipTime: tip.time,
    blockSeconds: BURN_BLOCK_SECONDS,
    generatedAt: Math.floor(Date.now() / 1000),
    market: market
      ? {
          contract: MARKET_CONTRACT,
          title: market.title,
          status: market.status,
          closeHeight: market.closeHeight,
          bondedCirc: market.bondedCirc,
          idleCirc: market.idleCirc,
          tradeable,
        }
      : null,
    sides,
  };
}

export function eligibilityOf(
  weights: Record<string, number> | null,
  minPosition: number,
  complete: boolean
): Eligibility {
  if (!weights) return { count: null, minPosition, checked: 0, complete: false };
  const values = Object.values(weights);
  return {
    count: values.filter((w) => w >= minPosition).length,
    minPosition,
    checked: values.length,
    complete,
  };
}

/** The state as a response. Never cached by the browser or the CDN. */
export async function legionsStateResponse(): Promise<Response> {
  const { env } = await getCloudflareContext();
  const state = await buildLegionsState(env);
  return Response.json(state, { headers: { "Cache-Control": "no-store" } });
}

/**
 * The same state as a plain object, for the Server Component. Null rather than
 * a throw: a page that cannot build state still renders and lets SWR retry.
 */
export async function loadLegionsState(): Promise<LegionsState | null> {
  try {
    const { env } = await getCloudflareContext();
    return await buildLegionsState(env);
  } catch (err) {
    log.error("legions.state_build_failed", { error: String(err) });
    return null;
  }
}

/** Drop the cached chain reads in this colo. Called after a chainhook delivery. */
export async function purgeLegionsState(): Promise<void> {
  await invalidateEdgeCache(CHAIN_CACHE_KEY);
}
