import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { withEdgeCache, buildEdgeCacheKey } from "@/lib/edge-cache";
import {
  classifyAddress,
  lookupProfileByStxAddress,
  lookupProfileByBtcAddress,
  lookupProfileByAgentId,
} from "@/lib/cache/agent-profile";
import {
  getAgentRollup,
  getAgentLineItems,
  getAgentEarningsBreakdown,
} from "@/lib/earnings/reads";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const CACHE_TTL_SECONDS = 300; // 5 min — indexer cadence is 30 min, so plenty fresh.

function selfDoc() {
  return NextResponse.json(
    {
      endpoint: "/api/agents/{address}/earnings",
      method: "GET",
      description:
        "Verified on-chain earnings for one agent: a 7d/30d/lifetime USD rollup plus recent line items. " +
        "Earnings are indexed from confirmed inbound sBTC/STX/aeUSDC transfers, classified by counterparty, " +
        "and priced in USD — self-dealing (self-funded / ring / alt-address) is excluded.",
      pathParameters: {
        address: "Agent STX address (SP…/SM…), BTC address, or numeric agent id.",
      },
      queryParameters: {
        limit: `Line items per page (1–${MAX_LIMIT}, default ${DEFAULT_LIMIT}).`,
        offset: "Line item offset (default 0).",
      },
      responseFormat: {
        address: "string (as supplied)",
        stxAddress: "string (canonical)",
        rollup: {
          earnings_7d_usd: "number",
          earnings_30d_usd: "number",
          earnings_lifetime_usd: "number",
          unique_payers_30d: "number",
          top_source_class_30d: "string | null",
        },
        breakdown: {
          by_source: "Array<{ source_class, total_usd }> — verified earnings by source",
          excluded_usd: "number — inbound NOT counted (self-dealing / unclassified)",
        },
        lineItems:
          "Array<{ txId, eventIndex, blockTime, sender, asset, amountRaw, amountUsd, sourceClass, sourceSubclass, explorerUrl }>",
        pagination: { limit: "number", offset: "number", hasMore: "boolean" },
      },
      relatedEndpoints: { platform: "/api/stats/earnings" },
    },
    { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } }
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  const url = new URL(request.url);
  if (url.searchParams.get("docs") === "1") return selfDoc();

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT)
  );
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);

  const cacheKey = buildEdgeCacheKey(
    "/api/agents",
    address,
    `/earnings?limit=${limit}&offset=${offset}`
  );

  // All work runs inside the loader so edge-cache hits skip the DB + context
  // resolve entirely (mirrors app/api/agents/[address]/route.ts).
  return withEdgeCache(cacheKey, CACHE_TTL_SECONDS, async () => {
    const { env } = await getCloudflareContext();
    const db = env.DB as D1Database | undefined;
    if (!db) {
      return NextResponse.json(
        { error: "Database unavailable." },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Resolve any address form → canonical agent stx_address.
    const branch = classifyAddress(address);
    let row = null;
    if (branch === "stx") row = await lookupProfileByStxAddress(db, address);
    else if (branch === "btc") row = await lookupProfileByBtcAddress(db, address);
    else if (branch === "numeric") {
      const id = parseInt(address, 10);
      if (Number.isFinite(id)) row = await lookupProfileByAgentId(db, id);
    }

    if (!row) {
      return NextResponse.json(
        {
          error:
            "Agent not found. Provide a registered STX address (SP…/SM…), BTC address, or numeric agent id.",
        },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    const stxAddress = row.stx_address;
    const now = Date.now();

    const [rollup, breakdown, items] = await Promise.all([
      getAgentRollup(db, stxAddress, now),
      getAgentEarningsBreakdown(db, stxAddress),
      getAgentLineItems(db, stxAddress, limit + 1, offset),
    ]);

    const hasMore = items.length > limit;
    const lineItems = (hasMore ? items.slice(0, limit) : items).map((i) => ({
      txId: i.tx_id,
      eventIndex: i.event_index,
      blockTime: i.block_time,
      sender: i.sender_stx,
      asset: i.asset,
      amountRaw: i.amount_raw,
      amountUsd: i.amount_usd,
      sourceClass: i.source_class,
      sourceSubclass: i.source_subclass,
      explorerUrl: `https://explorer.hiro.so/txid/${i.tx_id}?chain=mainnet`,
    }));

    return NextResponse.json(
      { address, stxAddress, rollup, breakdown, lineItems, pagination: { limit, offset, hasMore } },
      {
        headers: {
          "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}`,
        },
      }
    );
  });
}
