/**
 * Tests for lib/competition/parse.ts
 *
 * Phase 3.1 PR-B — fixtures for each Bitflow protocol shape.
 *
 * Approach: rather than hard-code a full Hiro response per protocol
 * (huge JSON blobs that decay quickly), each fixture exercises a specific
 * event-graph shape: simple two-leg swap, multi-hop xyk-helper, dlmm
 * router, provider-attribution path. The parser is event-graph driven so
 * these fixtures stay representative even if individual contracts evolve.
 */

import { describe, it, expect } from "vitest";
import { parseSwapFromTx, STX_ASSET_ID, type HiroTxForSwap } from "../parse";
import {
  AIBTC_PROVIDER_ADDRESS,
  PROVIDER_ATTRIBUTION_CONTRACTS,
} from "../allowlist";

const AGENT = "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE";
const POOL = "SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M";
const WSTX = "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.wstx::wstx";
const STSTX = "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token::ststx";

function baseTx(overrides: Partial<HiroTxForSwap> = {}): HiroTxForSwap {
  return {
    tx_id: "0xdeadbeef",
    tx_status: "success",
    sender_address: AGENT,
    tx_type: "contract_call",
    burn_block_time: 1762547890,
    contract_call: {
      contract_id: `${POOL}.stableswap-stx-ststx-v-1-2`,
      function_name: "swap-x-for-y",
      function_args: [],
    },
    events: [],
    ...overrides,
  };
}

describe("parseSwapFromTx — stableswap (simple two-leg)", () => {
  it("parses an outbound STX + inbound stSTX into a single SwapRow", () => {
    const tx = baseTx({
      events: [
        {
          event_index: 0,
          event_type: "stx_asset",
          asset: {
            asset_event_type: "transfer",
            sender: AGENT,
            recipient: POOL,
            amount: "1000000",
          },
        },
        {
          event_index: 1,
          event_type: "ft_transfer_event",
          asset: {
            asset_event_type: "transfer",
            sender: POOL,
            recipient: AGENT,
            amount: "859839",
            asset_id: STSTX,
          },
        },
      ],
    });

    const result = parseSwapFromTx(tx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.swap.token_in).toBe(STX_ASSET_ID);
    expect(result.swap.amount_in).toBe(1000000);
    expect(result.swap.token_out).toBe(STSTX);
    expect(result.swap.amount_out).toBe(859839);
    expect(result.swap.function_name).toBe("swap-x-for-y");
  });

  it("handles the reverse direction (ft out, stx in)", () => {
    const tx = baseTx({
      contract_call: {
        contract_id: `${POOL}.stableswap-stx-ststx-v-1-2`,
        function_name: "swap-y-for-x",
        function_args: [],
      },
      events: [
        {
          event_type: "ft_transfer_event",
          asset: {
            asset_event_type: "transfer",
            sender: AGENT,
            recipient: POOL,
            amount: "500000",
            asset_id: STSTX,
          },
        },
        {
          event_type: "stx_asset",
          asset: {
            asset_event_type: "transfer",
            sender: POOL,
            recipient: AGENT,
            amount: "580000",
          },
        },
      ],
    });

    const result = parseSwapFromTx(tx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.swap.token_in).toBe(STSTX);
    expect(result.swap.amount_in).toBe(500000);
    expect(result.swap.token_out).toBe(STX_ASSET_ID);
    expect(result.swap.amount_out).toBe(580000);
  });
});

describe("parseSwapFromTx — xyk multi-hop", () => {
  it("collapses an N-hop route to the largest outbound + largest inbound", () => {
    // Simulates xyk-swap-helper-c (swap through intermediate token).
    const ALEX = "SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.alex-token::alex";
    const tx = baseTx({
      contract_call: {
        contract_id: "SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.xyk-swap-helper-v-1-3",
        function_name: "swap-helper-c",
        function_args: [],
      },
      events: [
        // Agent sends STX to hop1
        {
          event_type: "stx_asset",
          asset: { asset_event_type: "transfer", sender: AGENT, recipient: POOL, amount: "1000000" },
        },
        // Intermediate hop ALEX → agent (small amount, should NOT be picked)
        {
          event_type: "ft_transfer_event",
          asset: { asset_event_type: "transfer", sender: POOL, recipient: AGENT, amount: "1", asset_id: ALEX },
        },
        // Agent sends ALEX onward (smaller — should NOT outrank initial STX leg)
        {
          event_type: "ft_transfer_event",
          asset: { asset_event_type: "transfer", sender: AGENT, recipient: POOL, amount: "1", asset_id: ALEX },
        },
        // Final receive: stSTX, large
        {
          event_type: "ft_transfer_event",
          asset: { asset_event_type: "transfer", sender: POOL, recipient: AGENT, amount: "859839", asset_id: STSTX },
        },
      ],
    });

    const result = parseSwapFromTx(tx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.swap.amount_in).toBe(1000000);
    expect(result.swap.token_in).toBe(STX_ASSET_ID);
    expect(result.swap.amount_out).toBe(859839);
    expect(result.swap.token_out).toBe(STSTX);
  });
});

describe("parseSwapFromTx — PR-E provider attribution", () => {
  it("extracts the `provider` clarity arg when the contract is in PROVIDER_ATTRIBUTION_CONTRACTS", () => {
    expect(PROVIDER_ATTRIBUTION_CONTRACTS.has(
      "SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.xyk-swap-helper-v-1-3"
    )).toBe(true);

    const tx = baseTx({
      contract_call: {
        contract_id: "SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.xyk-swap-helper-v-1-3",
        function_name: "swap-helper-a",
        function_args: [
          { name: "provider", type: "principal", repr: `'${AIBTC_PROVIDER_ADDRESS}` },
          { name: "amount-in", type: "uint", repr: "u1000000" },
        ],
      },
      events: [
        {
          event_type: "stx_asset",
          asset: { asset_event_type: "transfer", sender: AGENT, recipient: POOL, amount: "1000000" },
        },
        {
          event_type: "ft_transfer_event",
          asset: { asset_event_type: "transfer", sender: POOL, recipient: AGENT, amount: "859839", asset_id: STSTX },
        },
      ],
    });

    const result = parseSwapFromTx(tx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const audit = JSON.parse(result.swap.raw_event_json) as { provider?: string };
    expect(audit.provider).toBe(AIBTC_PROVIDER_ADDRESS);
  });

  it("does not include provider for contracts not in PROVIDER_ATTRIBUTION_CONTRACTS", () => {
    const tx = baseTx({
      contract_call: {
        contract_id: `${POOL}.stableswap-stx-ststx-v-1-2`,
        function_name: "swap-x-for-y",
        function_args: [
          { name: "provider", type: "principal", repr: `'${AIBTC_PROVIDER_ADDRESS}` },
        ],
      },
      events: [
        {
          event_type: "stx_asset",
          asset: { asset_event_type: "transfer", sender: AGENT, recipient: POOL, amount: "1000000" },
        },
        {
          event_type: "ft_transfer_event",
          asset: { asset_event_type: "transfer", sender: POOL, recipient: AGENT, amount: "859839", asset_id: STSTX },
        },
      ],
    });
    const result = parseSwapFromTx(tx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const audit = JSON.parse(result.swap.raw_event_json) as Record<string, unknown>;
    expect(audit.provider).toBeUndefined();
  });
});

describe("parseSwapFromTx — rejection paths", () => {
  it("rejects non-contract-call tx with not_contract_call", () => {
    const tx = baseTx({ tx_type: "token_transfer", contract_call: undefined });
    const result = parseSwapFromTx(tx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("not_contract_call");
  });

  it("rejects tx with no transfer events with no_transfer_events", () => {
    const tx = baseTx({ events: [] });
    const result = parseSwapFromTx(tx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("no_transfer_events");
  });

  it("rejects tx with only outbound transfers (incomplete swap) with incomplete_events", () => {
    const tx = baseTx({
      events: [
        {
          event_type: "stx_asset",
          asset: { asset_event_type: "transfer", sender: AGENT, recipient: POOL, amount: "1000000" },
        },
      ],
    });
    const result = parseSwapFromTx(tx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("incomplete_events");
  });

  it("rejects non-integer / negative / NaN amount with invalid_amount", () => {
    const tx = baseTx({
      events: [
        {
          event_type: "stx_asset",
          asset: { asset_event_type: "transfer", sender: AGENT, recipient: POOL, amount: "not-a-number" },
        },
      ],
    });
    const result = parseSwapFromTx(tx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_amount");
  });
});

describe("parseSwapFromTx — STX event_type variants (Hiro vocabulary)", () => {
  // Regression for the bug @secret-mars caught in PR #738 review: the Hiro
  // mainnet /extended/v1/tx/{txid} endpoint returns `stx_asset`, but older
  // tooling uses `stx_transfer_event` / `stx_transfer`. All three must
  // resolve to token_in = STX_ASSET_ID (not `unknown`).
  it.each([
    ["stx_asset"],          // Hiro mainnet /extended/v1
    ["stx_transfer_event"], // older blockchain-api emissions
    ["stx_transfer"],       // some downstream tooling
  ])("recognizes event_type=%s as native STX", (eventType) => {
    const tx = baseTx({
      events: [
        {
          event_type: eventType,
          asset: { asset_event_type: "transfer", sender: AGENT, recipient: POOL, amount: "1000000" },
        },
        {
          event_type: "ft_transfer_event",
          asset: { asset_event_type: "transfer", sender: POOL, recipient: AGENT, amount: "859839", asset_id: STSTX },
        },
      ],
    });
    const result = parseSwapFromTx(tx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.swap.token_in).toBe(STX_ASSET_ID);
    expect(result.swap.amount_in).toBe(1000000);
  });
});

describe("parseSwapFromTx — audit blob shape", () => {
  it("records both legs in raw_event_json so a reviewer can trace amounts back to events", () => {
    const tx = baseTx({
      events: [
        {
          event_type: "stx_asset",
          asset: { asset_event_type: "transfer", sender: AGENT, recipient: POOL, amount: "1000000" },
        },
        {
          event_type: "ft_transfer_event",
          asset: { asset_event_type: "transfer", sender: POOL, recipient: AGENT, amount: "859839", asset_id: STSTX },
        },
      ],
    });
    const result = parseSwapFromTx(tx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const audit = JSON.parse(result.swap.raw_event_json) as { legsOut: unknown[]; legsIn: unknown[] };
    expect(audit.legsOut).toHaveLength(1);
    expect(audit.legsIn).toHaveLength(1);
  });
});
