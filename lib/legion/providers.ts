/**
 * Provider-Legion reads (v1). A provider Legion is a guild of inference
 * operators who join the gateway for FREE and earn sBTC per call (the Legion's
 * treasury skims 8%). There is no bond and no slash: bad providers are handled
 * by an operator **flag** that de-routes them. An optional on-chain
 * `legion-engage` stake only buys ranking.
 *
 * The provider list comes from the gateway directory (`GET /v1/providers`,
 * lib/legion/gateway.ts), filtered to those serving this Legion's model, with
 * each provider's optional engage stake overlaid for ranking. Every read
 * degrades to a partial snapshot rather than throwing, and a failed build falls
 * back to `prev` so transient failures never blank good data.
 */

import { getTestnetTipHeight, legionReadOnly } from "./stacks";
import { toNum } from "./format";
import { legionEngageContract } from "./constants";
import { fetchGatewayProviders, providerServesModel } from "./gateway";
import { getMinStake, getStake, getTotalStaked } from "./engage";
import type { LegionEntry, ProviderRecord, ProviderSnapshot } from "./types";
import type { Logger } from "../logging";

/**
 * Assemble a full provider-Legion snapshot: treasury balance, engage stake
 * totals, and every gateway provider serving this Legion's model (ranked by
 * stake). `gatewayBase` overrides the default gateway (point it at the testnet
 * gateway via the LEGION_GATEWAY_URL Worker var).
 */
export async function buildProviderSnapshot(
  entry: LegionEntry,
  prev?: ProviderSnapshot | null,
  apiKey?: string,
  logger?: Logger,
  gatewayBase?: string,
): Promise<ProviderSnapshot> {
  const errors: string[] = [];
  const engageContract = legionEngageContract(entry.owner);

  const read = async <T>(label: string, task: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await task();
    } catch (e) {
      errors.push(`${label}: ${String(e)}`);
      logger?.warn?.("legion.provider_read_failed", { label, error: String(e) });
      return fallback;
    }
  };

  const [blockHeight, balanceRaw, minStake, totalStaked, directory] = await Promise.all([
    read("info.tip", () => getTestnetTipHeight(apiKey, logger), null),
    read(
      "treasury.get-balance",
      () => legionReadOnly(entry.treasury, "get-balance", [], apiKey, logger),
      null,
    ),
    read("engage.get-min-stake", () => getMinStake(engageContract, apiKey, logger), null),
    read("engage.get-total-staked", () => getTotalStaked(engageContract, apiKey, logger), null),
    read("gateway.providers", () => fetchGatewayProviders(gatewayBase, logger), []),
  ]);

  const serving = directory.filter((p) => providerServesModel(p, entry.model));

  const providers: ProviderRecord[] = (
    await Promise.all(
      serving.map(async (p) => {
        const stake = await read(
          `engage.get-stake.${p.address}`,
          () => getStake(engageContract, p.address, apiKey, logger),
          0,
        );
        return {
          address: p.address,
          name: p.name,
          model: p.model,
          endpoint: p.endpoint,
          stake,
          health: p.health,
          flagged: p.flagged,
          active: !p.flagged && p.health === "up",
        };
      }),
    )
  ).sort((a, b) => b.stake - a.stake);

  return {
    updatedAt: Date.now(),
    blockHeight: blockHeight ?? prev?.blockHeight ?? null,
    entry,
    treasuryBalance: balanceRaw != null ? toNum(balanceRaw) : (prev?.treasuryBalance ?? null),
    minStake: minStake ?? prev?.minStake ?? null,
    totalStaked: totalStaked ?? prev?.totalStaked ?? null,
    providers: providers.length > 0 ? providers : (prev?.providers ?? []),
    errors,
  };
}

/**
 * Count of providers serving a Legion's model in the gateway directory (for the
 * `/legions` index). Best-effort: 0 on any failure.
 */
export async function countProviders(
  model: string,
  gatewayBase?: string,
  logger?: Logger,
): Promise<number> {
  const directory = await fetchGatewayProviders(gatewayBase, logger);
  return directory.filter((p) => providerServesModel(p, model)).length;
}
