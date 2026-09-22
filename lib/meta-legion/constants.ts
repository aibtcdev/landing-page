/**
 * The Legion Exchange v2: one contract holding every legion, each a YES/NO
 * share market paid in sBTC on one fixed question: will any of these Bitcoin
 * addresses bond in pox-5 before the deadline? Nobody decides answers. YES
 * settles when anyone submits a Bitcoin proof of the bond (`resolve-bonded`),
 * NO when anyone calls `resolve-idle` after the proof grace.
 *
 * Legion 0 is the meta legion: will `target` legions clear the trading bar in
 * each of the three epochs before the close? The contract answers it from its
 * own scoreboard.
 *
 * v1 (SP3ZXQV0BV07PH24ZWETHWM6MPQRHSYWPGAZAX2PR.legion-exchange, human
 * resolvers) is superseded and no longer read.
 *
 * Source and design notes: https://github.com/aibtcdev/legions/tree/main/meta
 */

export const EXCHANGE_DEPLOYER = "SP3EF02CC2CGWJ327TXXW7JD4B9K9F1R0FSVY3659";
export const EXCHANGE_CONTRACT = `${EXCHANGE_DEPLOYER}.legion-exchange-v2`;
export const SBTC_TOKEN = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
export const EXCHANGE_SOURCE_HREF = "https://github.com/aibtcdev/legions/tree/main/meta";

export const META_LEGION_ID = 0;

/** `side` argument: u1 YES, u0 NO. */
export const SIDE = { NO: 0, YES: 1 } as const;
export type Side = (typeof SIDE)[keyof typeof SIDE];

/** Legion `status`. */
export const LEGION_STATUS = { OPEN: 0, YES: 1, NO: 2 } as const;

/** Prices are ten-thousandths of a sat per share: 5000 is 50%. */
export const PRICE_SCALE = 10_000;

/**
 * Blocks after a legion's deadline during which a YES proof is still accepted
 * (`PROOF_GRACE`). After it, anyone may settle NO with `resolve-idle`.
 */
export const PROOF_GRACE_BLOCKS = 1_008;

/** Terms as `meta-terms` returns them. */
export interface MetaTerms {
  target: number;
  closeHeight: number;
  /** The three counted epochs, oldest first. */
  epochs: number[];
  epochBlocks: number;
  minVolume: number;
  minTraders: number;
  feeBps: number;
  maxCollateral: number;
  feeSink: string;
  proofGrace: number;
  /** Most addresses a legion can ask about. */
  maxScripts: number;
}

/**
 * The exchange's constants, as `meta-terms` returns them on mainnet. The
 * contract has no setter and no upgrade path, so they never change.
 */
export const TERMS: MetaTerms = {
  target: 50,
  closeHeight: 993_888,
  epochs: [490, 491, 492],
  epochBlocks: 2_016,
  minVolume: 50_000,
  minTraders: 3,
  feeBps: 200,
  maxCollateral: 50_000,
  feeSink: "SP15JW68V8FWK09JEBEEYX31SCD7NK2CWK16511M7",
  proofGrace: PROOF_GRACE_BLOCKS,
  maxScripts: 10,
};

/**
 * Legion 0 is written into the map at deploy, which prints nothing, so its row
 * is not in the event log. These are its stored values (`get-legion u0`).
 */
export const META_LABEL = "Will 50 legions be actively traded in the final 6 weeks?";
/** Burn height of the deploy, legion 0's `created-at`. */
export const META_CREATED_AT = 968_124;

/** Edge-cache lifetime of the burn tip. Events are read fresh from D1. */
export const TIP_TTL_SECONDS = 60;

/**
 * Events folded per request. The fold needs the whole log to be exact; this is
 * a backstop, and the page flags it when it is reached.
 */
export const MAX_EVENTS = 50_000;
