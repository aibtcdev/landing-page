"use client";

import { SWRConfig } from "swr";
import { fetcher } from "@/lib/fetcher";
import { DEFAULT_CACHE_MS } from "@/lib/swr-keys";

/**
 * Global SWR config. Sets a 15-minute cache window for every useSWR call
 * (any second call to the same key within 15 min returns cached data without
 * a network request).
 *
 * Polling components (ActivityFeed, RelayStatus, ActivityFeedHero) MUST
 * override `dedupingInterval` locally to a value at or below their
 * `refreshInterval` — otherwise the dedupe window silently blocks the
 * polling tick from firing.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher,
        dedupingInterval: DEFAULT_CACHE_MS,
        revalidateOnFocus: true,
        revalidateOnReconnect: true,
        keepPreviousData: true,
      }}
    >
      {children}
    </SWRConfig>
  );
}
