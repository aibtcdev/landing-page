/**
 * Inference-gateway directory reads (v1 provider source).
 *
 * In v1 providers join the gateway for FREE — there is no on-chain bond and no
 * slash. The gateway's public `GET /v1/providers` is the authoritative provider
 * list, with health + operator flag status. The landing page overlays each
 * provider's optional `legion-engage` stake (see lib/legion/engage.ts) for
 * ranking. All reads here are best-effort: a gateway that is unreachable (e.g.
 * the testnet gateway isn't deployed yet) degrades to an empty list, never an
 * error, so the page still renders "no providers yet — join free".
 */

import { DEFAULT_LEGION_GATEWAY_URL } from "./constants";
import type { Logger } from "../logging";

/** A provider as listed by the gateway, before the engage-stake overlay. */
export interface GatewayProvider {
  /** STX payout address — the key that joins to `legion-engage get-stake`. */
  address: string;
  name: string;
  model: string;
  endpoint: string;
  health: string;
  flagged: boolean;
}

interface RawGatewayProvider {
  id?: string;
  name?: string;
  endpoint?: string;
  payoutAddress?: string;
  models?: Array<{ id?: string }>;
  health?: { status?: string };
  status?: string;
  flagged?: boolean;
}

/** Normalize a model id/token for fuzzy capability matching ("Qwen/Qwen2.5-7B" → "qwen257b"). */
function normalizeModel(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Does this provider serve a Legion's advertised model? Fuzzy: the gateway uses
 * ids like "Qwen/Qwen2.5-7B-Instruct" while the registry stores "qwen2.5-7b", so
 * we match on a normalized substring either way. An empty Legion model (or a
 * provider with no models) matches everything — the shared directory is the
 * default for a Legion that doesn't pin a capability.
 */
export function providerServesModel(provider: GatewayProvider, legionModel: string): boolean {
  const legion = normalizeModel(legionModel);
  if (!legion) return true;
  const model = normalizeModel(provider.model);
  if (!model) return true;
  return model.includes(legion) || legion.includes(model);
}

function normalize(raw: RawGatewayProvider): GatewayProvider | null {
  const address = typeof raw.payoutAddress === "string" ? raw.payoutAddress : "";
  if (!address) return null;
  return {
    address,
    name: typeof raw.name === "string" ? raw.name : "",
    model: raw.models?.[0]?.id ?? "",
    endpoint: typeof raw.endpoint === "string" ? raw.endpoint : "",
    health: raw.health?.status ?? raw.status ?? "unknown",
    flagged: Boolean(raw.flagged),
  };
}

/**
 * Fetch the gateway provider directory. Returns [] on any failure (unreachable
 * gateway, non-200, malformed body) — callers treat that as "no providers yet".
 */
export async function fetchGatewayProviders(
  gatewayBase: string | undefined,
  logger?: Logger,
): Promise<GatewayProvider[]> {
  const base = (gatewayBase || DEFAULT_LEGION_GATEWAY_URL).replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/v1/providers`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      logger?.warn?.("legion.gateway_providers_http", { base, status: res.status });
      return [];
    }
    const body = (await res.json()) as { data?: RawGatewayProvider[] };
    const data = Array.isArray(body?.data) ? body.data : [];
    return data
      .map(normalize)
      .filter((p): p is GatewayProvider => p !== null);
  } catch (e) {
    logger?.warn?.("legion.gateway_providers_failed", { base, error: String(e) });
    return [];
  }
}
