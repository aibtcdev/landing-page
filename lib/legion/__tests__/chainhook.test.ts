import { describe, it, expect } from "vitest";
import { Cl, serializeCV } from "@stacks/transactions";
import { extractEvents, isAuthorisedDelivery, rollbackTxids, type ChainhookBlock } from "../chainhook";
import { LEGIONS, LEGION_CONTRACTS } from "../constants";

const PROPOSER = "SP5Y3W3F78NKFH4HYFNDQMJC484VZWKDH35ZR2M9";

function proposePrintHex(): string {
  return `0x${serializeCV(
    Cl.tuple({
      event: Cl.stringAscii("propose"),
      side: Cl.stringAscii("bonded"),
      proposalId: Cl.uint(1),
      proposer: Cl.principal(PROPOSER),
      link: Cl.stringAscii("https://github.com/aibtcdev/legions/commit/9068816"),
      title: Cl.stringAscii("v2 terms verified"),
      proposerWeight: Cl.uint(1300),
      payout: Cl.uint(3000),
      voteEnd: Cl.uint(966560),
      votableAtOpen: Cl.uint(1300),
      vault: Cl.uint(300000),
    })
  )}`;
}

function block(ops: { contract: string; value: unknown; status?: string }[]): ChainhookBlock {
  return {
    block_identifier: { index: 8966566 },
    timestamp: 1789145834,
    transactions: ops.map((op, i) => ({
      transaction_identifier: { hash: `0xtx${i}` },
      metadata: { status: op.status ?? "success" },
      operations: [
        {
          type: "contract_log",
          operation_identifier: { index: 2 },
          metadata: { contract_identifier: op.contract, topic: "print", value: op.value },
        },
      ],
    })),
  };
}

describe("extractEvents", () => {
  it("decodes a hex print into a row with exact numbers and principals", () => {
    const rows = extractEvents([block([{ contract: LEGIONS.yes.contract, value: { hex: proposePrintHex() } }])], LEGION_CONTRACTS);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.event).toBe("propose");
    expect(r.proposal_id).toBe(1);
    expect(r.event_index).toBe(2);
    expect(r.block_height).toBe(8966566);
    expect(r.block_time).toBe(1789145834);
    expect(r.contract_id).toBe(LEGIONS.yes.contract);
    expect(r.data.proposer).toBe(PROPOSER);
    expect(r.data.voteEnd).toBe(966560);
  });

  it("accepts a bare hex string value", () => {
    const rows = extractEvents([block([{ contract: LEGIONS.no.contract, value: proposePrintHex() }])], LEGION_CONTRACTS);
    expect(rows).toHaveLength(1);
    expect(rows[0].contract_id).toBe(LEGIONS.no.contract);
  });

  it("drops prints from unwatched contracts and failed transactions", () => {
    const rows = extractEvents(
      [
        block([
          { contract: `${PROPOSER}.elsalvador-stakes-btc-v2`, value: proposePrintHex() },
          { contract: LEGIONS.yes.contract, value: proposePrintHex(), status: "abort_by_response" },
        ]),
      ],
      LEGION_CONTRACTS
    );
    expect(rows).toHaveLength(0);
  });

  it("reads rollback txids", () => {
    expect(rollbackTxids([block([{ contract: LEGIONS.yes.contract, value: proposePrintHex() }])])).toEqual(["0xtx0"]);
  });
});

describe("isAuthorisedDelivery", () => {
  const secret = "s3cret-value";
  it("accepts the consumer-secret header", () => {
    const req = new Request("https://aibtc.com/api/legions/chainhook", {
      method: "POST",
      headers: { "x-chainhook-consumer-secret": secret },
    });
    expect(isAuthorisedDelivery(req, secret)).toBe(true);
  });
  it("accepts the ?t= token", () => {
    const req = new Request(`https://aibtc.com/api/legions/chainhook?t=${secret}`, { method: "POST" });
    expect(isAuthorisedDelivery(req, secret)).toBe(true);
  });
  it("rejects a wrong or missing secret", () => {
    const wrong = new Request("https://aibtc.com/api/legions/chainhook?t=nope", {
      method: "POST",
      headers: { "x-chainhook-consumer-secret": "also-nope" },
    });
    expect(isAuthorisedDelivery(wrong, secret)).toBe(false);
    expect(isAuthorisedDelivery(new Request("https://aibtc.com/x", { method: "POST" }), secret)).toBe(false);
  });
});
