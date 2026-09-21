/**
 * The Legion Exchange: one contract holding every legion (a yes/no question
 * with its own YES/NO share market, paid in sBTC). Legion 0 is the meta legion,
 * which asks whether the exchange itself takes off: at least `target` legions
 * clearing the trading bar in each of the three epochs before the close. The
 * contract answers it from its own scoreboard; nobody resolves it by hand.
 *
 * Source and design notes: https://github.com/aibtcdev/legions/tree/main/meta
 */

export const EXCHANGE_DEPLOYER = "SP3ZXQV0BV07PH24ZWETHWM6MPQRHSYWPGAZAX2PR";
export const EXCHANGE_CONTRACT = `${EXCHANGE_DEPLOYER}.legion-exchange`;
export const SBTC_TOKEN = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
export const EXCHANGE_SOURCE_HREF = "https://github.com/aibtcdev/legions/tree/main/meta";

export const META_LEGION_ID = 0;

/** `side` argument: u1 YES, u0 NO. */
export const SIDE = { NO: 0, YES: 1 } as const;
export type Side = (typeof SIDE)[keyof typeof SIDE];

/** Legion `status`. */
export const LEGION_STATUS = { OPEN: 0, YES: 1, NO: 2, VOID: 3 } as const;

/** Prices are ten-thousandths of a sat per share: 5000 is 50%. */
export const PRICE_SCALE = 10_000;

/**
 * Blocks after a legion's resolve date before anyone may void it. Not returned
 * by `meta-terms`; the contract's `GRACE_BLOCKS`.
 */
export const VOID_GRACE_BLOCKS = 1_008;

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
};

/**
 * Legion 0 is written into the map at deploy, which prints nothing, so its row
 * is not in the event log. These are its stored values (`get-legion u0`).
 */
export const META_SUBJECT =
  "At least 50 distinct legions clear the trading bar in each of the three epochs before the close height";

/** Edge-cache lifetime of the burn tip. Events are read fresh from D1. */
export const TIP_TTL_SECONDS = 60;

/**
 * Events folded per request. The fold needs the whole log to be exact; this is
 * a backstop, and the page flags it when it is reached.
 */
export const MAX_EVENTS = 50_000;
