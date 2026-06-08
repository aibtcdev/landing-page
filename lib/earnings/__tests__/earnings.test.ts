import { describe, it, expect, vi } from "vitest";
import { assetInfoForFt, assetInfoForAsset } from "../assets";
import { extractInboundTransfers } from "../ingest";
import { classifyTransfer } from "../classify";
import { priceTransfer } from "../price";
import type { InboundTransfer } from "../types";

const AGENT = "SP_AGENT_RECIPIENT";
const PEER = "SP_OTHER_AGENT";
const SBTC_ASSET_ID =
  "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token";
const AEUSDC_ASSET_ID =
  "SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.token-aeusdc::aeusdc";

// ─────────────────────────── assets ───────────────────────────

describe("assetInfoForFt", () => {
  it("maps sBTC (8 decimals, not stablecoin)", () => {
    const info = assetInfoForFt(SBTC_ASSET_ID);
    expect(info).toEqual({
      asset: "sbtc",
      decimals: 8,
      teneroTokenId: SBTC_ASSET_ID,
      stablecoin: false,
    });
  });

  it("maps aeUSDC (6 decimals, stablecoin) regardless of asset suffix", () => {
    const info = assetInfoForFt(AEUSDC_ASSET_ID);
    expect(info?.asset).toBe("aeusdc");
    expect(info?.decimals).toBe(6);
    expect(info?.stablecoin).toBe(true);
  });

  it("returns null for an untracked token", () => {
    expect(assetInfoForFt("SP000.random-token::x")).toBeNull();
  });
});

describe("assetInfoForAsset", () => {
  it("resolves stx / sbtc / aeusdc", () => {
    expect(assetInfoForAsset("stx").decimals).toBe(6);
    expect(assetInfoForAsset("sbtc").decimals).toBe(8);
    expect(assetInfoForAsset("aeusdc").stablecoin).toBe(true);
  });
});

// ─────────────────────────── ingest ───────────────────────────

describe("extractInboundTransfers", () => {
  it("extracts inbound STX + sBTC with stable event_index, skips outbound", () => {
    const tx = {
      tx: { tx_id: "0xabc", tx_status: "success", block_height: 100, burn_block_time: 1700 },
      stx_transfers: [
        { amount: "1000000", sender: PEER, recipient: AGENT }, // inbound, idx 0
        { amount: "500", sender: AGENT, recipient: PEER }, // outbound, idx 1 (skip)
      ],
      ft_transfers: [
        { amount: "42000", sender: PEER, recipient: AGENT, asset_identifier: SBTC_ASSET_ID }, // inbound, idx 2
      ],
    };
    const out = extractInboundTransfers(tx, AGENT);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ asset: "stx", eventIndex: 0, amountRaw: 1000000, senderStx: PEER });
    expect(out[1]).toMatchObject({ asset: "sbtc", eventIndex: 2, amountRaw: 42000 });
    expect(out.every((t) => t.recipientAgentStx === AGENT && t.blockTime === 1700)).toBe(true);
  });

  it("skips non-success, unanchored, self-transfers, and untracked assets", () => {
    expect(
      extractInboundTransfers(
        { tx: { tx_id: "0x1", tx_status: "abort_by_response", block_height: 1, burn_block_time: 1 },
          stx_transfers: [{ amount: "1", sender: PEER, recipient: AGENT }] },
        AGENT
      )
    ).toHaveLength(0);

    expect(
      extractInboundTransfers(
        { tx: { tx_id: "0x2", tx_status: "success", is_unanchored: true, block_height: 1, burn_block_time: 1 },
          stx_transfers: [{ amount: "1", sender: PEER, recipient: AGENT }] },
        AGENT
      )
    ).toHaveLength(0);

    expect(
      extractInboundTransfers(
        { tx: { tx_id: "0x3", tx_status: "success", block_height: 1, burn_block_time: 1 },
          stx_transfers: [{ amount: "1", sender: AGENT, recipient: AGENT }],
          ft_transfers: [{ amount: "1", sender: PEER, recipient: AGENT, asset_identifier: "SP.unknown::x" }] },
        AGENT
      )
    ).toHaveLength(0);
  });
});

// ─────────────────────────── classify ───────────────────────────

function transfer(overrides: Partial<InboundTransfer> = {}): InboundTransfer {
  return {
    txId: "0xtx",
    eventIndex: 0,
    senderStx: PEER,
    recipientAgentStx: AGENT,
    asset: "sbtc",
    amountRaw: 1000,
    stxBlockHeight: 100,
    blockTime: 1700,
    ...overrides,
  };
}

/** D1 mock whose three classification queries return preset rows (or null). */
function classifyDb(rows: { inbox?: unknown; bounty?: unknown; agent?: unknown }) {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn().mockResolvedValue(
          sql.includes("inbox_messages")
            ? rows.inbox ?? null
            : sql.includes("bounties")
              ? rows.bounty ?? null
              : sql.includes("agents")
                ? rows.agent ?? null
                : null
        ),
      })),
    })),
  } as unknown as D1Database;
}

describe("classifyTransfer", () => {
  it("classifies a confirmed inbox payment", async () => {
    const c = await classifyTransfer(classifyDb({ inbox: { message_id: "m1" } }), transfer());
    expect(c).toEqual({ sourceClass: "inbox_message", sourceSubclass: "m1", excludedReason: null, isEarning: true });
  });

  it("classifies a paid bounty to the winner", async () => {
    const c = await classifyTransfer(classifyDb({ bounty: { id: "b1" } }), transfer());
    expect(c).toMatchObject({ sourceClass: "bounty", sourceSubclass: "b1", isEarning: true });
  });

  it("classifies a registered peer agent", async () => {
    const c = await classifyTransfer(classifyDb({ agent: { x: 1 } }), transfer());
    expect(c).toMatchObject({ sourceClass: "agent_peer", isEarning: true });
  });

  it("falls back to unclassified (excluded) when nothing matches", async () => {
    const c = await classifyTransfer(classifyDb({}), transfer());
    expect(c).toEqual({
      sourceClass: "unclassified",
      sourceSubclass: null,
      excludedReason: "unclassified",
      isEarning: false,
    });
  });
});

// ─────────────────────────── price ───────────────────────────

function kvWith(prices: Record<string, { priceUsd: number | null; fetchedAt: number }>) {
  return {
    get: vi.fn(async (key: string) => {
      const id = key.replace("tenero:price:", "");
      return prices[id] ?? null;
    }),
  } as unknown as KVNamespace;
}

describe("priceTransfer", () => {
  it("prices aeUSDC at the $1 peg without a Tenero lookup", async () => {
    const kv = kvWith({});
    const p = await priceTransfer(kv, transfer({ asset: "aeusdc", amountRaw: 2_500_000 }), 999);
    expect(p).toEqual({ amountUsd: 2.5, priceUsd: 1, priceSource: "stablecoin", pricedAt: 999 });
    expect(kv.get).not.toHaveBeenCalled();
  });

  it("prices sBTC from the Tenero cache", async () => {
    const kv = kvWith({ [assetInfoForAsset("sbtc").teneroTokenId]: { priceUsd: 100_000, fetchedAt: 1 } });
    // 50_000 sats = 0.0005 sBTC * $100,000 = $50
    const p = await priceTransfer(kv, transfer({ asset: "sbtc", amountRaw: 50_000 }), 999);
    expect(p.priceSource).toBe("tenero");
    expect(p.amountUsd).toBeCloseTo(50, 6);
  });

  it("leaves unpriced when the cache has no price", async () => {
    const p = await priceTransfer(kvWith({}), transfer({ asset: "stx", amountRaw: 1_000_000 }), 999);
    expect(p).toEqual({ amountUsd: null, priceUsd: null, priceSource: "none", pricedAt: 999 });
  });
});
