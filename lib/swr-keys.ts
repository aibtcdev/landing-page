/**
 * Centralized SWR cache key builders.
 *
 * Components should never build endpoint URLs inline for useSWR — always use
 * a helper here. This guarantees that mutation invalidation (matcher functions
 * below) covers every cached variant of a resource.
 */

type InboxOpts = {
  limit?: number;
  offset?: number;
  view?: string;
  includePartners?: boolean;
};

type OutboxOpts = {
  limit?: number;
  offset?: number;
};

function buildQuery(parts: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(parts)) {
    if (v === undefined || v === null || v === false) continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export const swrKeys = {
  inbox: (btcAddress: string, opts: InboxOpts = {}) =>
    `/api/inbox/${encodeURIComponent(btcAddress)}${buildQuery({
      limit: opts.limit,
      offset: opts.offset,
      view: opts.view,
      include: opts.includePartners ? "partners" : undefined,
    })}`,
  inboxMessage: (btcAddress: string, messageId: string) =>
    `/api/inbox/${encodeURIComponent(btcAddress)}/${encodeURIComponent(messageId)}`,
  outbox: (btcAddress: string, opts: OutboxOpts = {}) =>
    `/api/outbox/${encodeURIComponent(btcAddress)}${buildQuery({
      limit: opts.limit,
      offset: opts.offset,
    })}`,
  reputationSummary: (address: string) =>
    `/api/identity/${encodeURIComponent(address)}/reputation?type=summary`,
  reputationFeedback: (address: string, cursor?: number | null) =>
    `/api/identity/${encodeURIComponent(address)}/reputation?type=feedback${
      cursor != null ? `&cursor=${cursor}` : ""
    }`,
  identity: (stxAddress: string) =>
    `/api/identity/${encodeURIComponent(stxAddress)}`,
  vouch: (btcAddress: string) =>
    `/api/vouch/${encodeURIComponent(btcAddress)}`,
  leaderboard: (limit: number) => `/api/leaderboard?limit=${limit}`,
  activity: () => "/api/activity",
  statusSummary: () => "/api/status/summary",
} as const;

/**
 * Matchers for invalidating every cached variant of a resource via
 * `mutate(matcher, undefined, { revalidate: true })`.
 *
 * Use these when a POST/PATCH changes data and you need to refresh every
 * dependent query — e.g., a new reply should invalidate both inbox and outbox
 * regardless of which pagination cursor each component is sitting on.
 */
export const swrMatchers = {
  anyInbox: (btcAddress: string) => {
    const prefix = `/api/inbox/${encodeURIComponent(btcAddress)}`;
    return (key: unknown) => typeof key === "string" && key.startsWith(prefix);
  },
  anyOutbox: (btcAddress: string) => {
    const prefix = `/api/outbox/${encodeURIComponent(btcAddress)}`;
    return (key: unknown) => typeof key === "string" && key.startsWith(prefix);
  },
  anyReputation: (address: string) => {
    const prefix = `/api/identity/${encodeURIComponent(address)}/reputation`;
    return (key: unknown) => typeof key === "string" && key.startsWith(prefix);
  },
  anyIdentity: (stxAddress: string) => {
    const prefix = `/api/identity/${encodeURIComponent(stxAddress)}`;
    return (key: unknown) => typeof key === "string" && key.startsWith(prefix);
  },
};

/**
 * Default cache lifetime. Components inherit this via the global SWRConfig
 * unless they pass an explicit override (polling components do, since
 * dedupingInterval blocks refreshInterval from firing).
 */
export const DEFAULT_CACHE_MS = 15 * 60 * 1000;
