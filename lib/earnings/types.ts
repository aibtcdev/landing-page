/**
 * Earnings indexer types (issue #978, Phase 1).
 */

export type EarningAsset = "sbtc" | "stx" | "aeusdc";

export type SourceClass =
  | "inbox_message"
  | "bounty"
  | "x402_endpoint"
  | "agent_peer"
  | "exchange_or_external"
  | "unclassified";

export type ExcludedReason =
  | "self_funded"
  | "ring"
  | "external"
  | "unclassified"
  | "excluded_manual";

export type PriceSource = "tenero" | "stablecoin" | "last_good" | "none";

/** One confirmed inbound transfer to an agent, as read from Hiro. */
export interface InboundTransfer {
  txId: string;
  /** Index of this transfer within the tx (stx + ft transfers, stable order). */
  eventIndex: number;
  senderStx: string;
  recipientAgentStx: string;
  asset: EarningAsset;
  amountRaw: number;
  stxBlockHeight: number | null;
  /** Unix seconds. */
  blockTime: number;
}

/** Classification result layered onto an InboundTransfer. */
export interface Classification {
  sourceClass: SourceClass;
  sourceSubclass: string | null;
  excludedReason: ExcludedReason | null;
  isEarning: boolean;
}

/** Pricing result layered onto an InboundTransfer. */
export interface Pricing {
  amountUsd: number | null;
  priceUsd: number | null;
  priceSource: PriceSource;
  pricedAt: number;
}

/** A fully-resolved ledger row ready to persist to `agent_earnings`. */
export interface EarningRow
  extends InboundTransfer,
    Classification,
    Pricing {
  indexedAt: number;
}

/** Per-tick summary, surfaced in the scheduler status like the competition sweep. */
export interface EarningsSweepSummary {
  enabled: boolean;
  agentsScanned: number;
  transfersFound: number;
  inserted: number;
  alreadyKnown: number;
  earningRows: number;
  excludedRows: number;
  hiroCalls: number;
  bySourceClass: Record<SourceClass, number>;
  cursor: string | null;
}
