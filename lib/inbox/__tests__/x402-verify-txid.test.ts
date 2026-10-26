import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyTxidPayment } from "../x402-verify";
import { INBOX_PRICE_SATS, SBTC_CONTRACTS } from "../constants";

const SBTC = `${SBTC_CONTRACTS.mainnet.address}.${SBTC_CONTRACTS.mainnet.name}`;
const PAYER = "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR";
const RECIPIENT = "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE";
const OTHER = "SP229F3KDGJJ79DMAPHKYQD6KF6DXM2NPAKHZ51HR";
const WRAPPER = `${OTHER}.gasless-transfer`;
const TXID = "ab".repeat(32);

function ftEvent(event_index: number, sender: string, recipient: string, amount: number) {
  return {
    event_index,
    event_type: "fungible_token_asset",
    asset: {
      asset_event_type: "transfer",
      asset_id: `${SBTC}::sbtc-token`,
      sender,
      recipient,
      amount: String(amount),
    },
  };
}

function directTx() {
  return {
    tx_id: `0x${TXID}`,
    tx_status: "success",
    tx_type: "contract_call",
    sender_address: PAYER,
    contract_call: {
      contract_id: SBTC,
      function_name: "transfer",
      function_args: [
        { name: "amount", type: "uint", repr: `u${INBOX_PRICE_SATS}` },
        { name: "sender", type: "principal", repr: `'${PAYER}` },
        { name: "recipient", type: "principal", repr: `'${RECIPIENT}` },
        { name: "memo", type: "(optional (buff 34))", repr: "none" },
      ],
    },
    events: [ftEvent(0, PAYER, RECIPIENT, INBOX_PRICE_SATS)],
  };
}

// A payment routed through a contract that forwards to `sbtc-token.transfer`:
// the fee to the wrapper comes first, the payment to the recipient after it.
function routedTx(events: unknown[]) {
  return {
    ...directTx(),
    contract_call: {
      contract_id: WRAPPER,
      function_name: "transfer-stacks-to-stacks",
      function_args: [
        { name: "amount", type: "uint", repr: `u${INBOX_PRICE_SATS}` },
        { name: "recipient", type: "principal", repr: `'${RECIPIENT}` },
        { name: "memo", type: "(optional (buff 34))", repr: "none" },
        { name: "fee", type: "uint", repr: "u10" },
      ],
    },
    events,
  };
}

function stubHiro(tx: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(tx), { status: 200 }))
  );
}

describe("verifyTxidPayment", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts a direct sbtc-token.transfer", async () => {
    stubHiro(directTx());
    const r = await verifyTxidPayment(TXID, RECIPIENT);
    expect(r).toMatchObject({ success: true, payerStxAddress: PAYER, paymentTxid: TXID });
  });

  it("accepts a payment routed through a contract that forwards to sbtc-token.transfer", async () => {
    stubHiro(
      routedTx([ftEvent(0, PAYER, WRAPPER, 10), ftEvent(2, PAYER, RECIPIENT, INBOX_PRICE_SATS)])
    );
    const r = await verifyTxidPayment(TXID, RECIPIENT);
    expect(r).toMatchObject({ success: true, payerStxAddress: PAYER, paymentTxid: TXID });
  });

  it("routed: returns NOT_SBTC_TRANSFER when the sender moved no sBTC", async () => {
    stubHiro(routedTx([ftEvent(0, WRAPPER, RECIPIENT, INBOX_PRICE_SATS)]));
    const r = await verifyTxidPayment(TXID, RECIPIENT);
    expect(r).toMatchObject({ success: false, errorCode: "NOT_SBTC_TRANSFER" });
  });

  it("routed: returns RECIPIENT_MISMATCH when the sBTC went to someone else", async () => {
    stubHiro(routedTx([ftEvent(0, PAYER, OTHER, INBOX_PRICE_SATS)]));
    const r = await verifyTxidPayment(TXID, RECIPIENT);
    expect(r).toMatchObject({ success: false, errorCode: "RECIPIENT_MISMATCH" });
  });

  it("routed: returns INSUFFICIENT_AMOUNT when the transfer to the recipient is below the price", async () => {
    stubHiro(
      routedTx([ftEvent(0, PAYER, WRAPPER, 1000), ftEvent(2, PAYER, RECIPIENT, INBOX_PRICE_SATS - 1)])
    );
    const r = await verifyTxidPayment(TXID, RECIPIENT);
    expect(r).toMatchObject({ success: false, errorCode: "INSUFFICIENT_AMOUNT" });
  });
});
