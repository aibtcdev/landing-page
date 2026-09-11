/**
 * The El Salvador legions: two contracts arguing opposite sides of one
 * prediction market, `elsalvador-stakes-btc-v2`.
 *
 *   yes-legion  argues BONDED: El Salvador's reserve Bitcoin entered a PoX-5
 *               protocol bond in periods 2 through 7 before burn height 994,699
 *   no-legion   argues IDLE: it did not
 *
 * Neither contract holds a treasury or a member roster. Voting weight is read
 * live off the market (your shares on that side), and each vault is the
 * legion's own share position, paid out 3,000 shares per approved proposal.
 * Source: https://github.com/aibtcdev/legions/tree/main/stake
 */

export const LEGION_DEPLOYER = "SP5Y3W3F78NKFH4HYFNDQMJC484VZWKDH35ZR2M9";
export const MARKET_CONTRACT = `${LEGION_DEPLOYER}.elsalvador-stakes-btc-v2`;

export type LegionSide = "yes" | "no";

export interface LegionConfig {
  side: LegionSide;
  contract: string;
  /** What the legion is called on the page. */
  name: string;
  /** The market outcome this side argues for. */
  argues: "Yes" | "No";
  /** The market's name for this side's shares. */
  shareLabel: "Bonded" | "Idle";
  /** The market's side index (`u1` Bonded, `u0` Idle). */
  marketSide: 1 | 0;
  /** The market status that means this side won (`u1` Bonded, `u2` Idle). */
  winStatus: 1 | 2;
}

export const LEGIONS: Record<LegionSide, LegionConfig> = {
  yes: {
    side: "yes",
    contract: `${LEGION_DEPLOYER}.elsalvador-yes-legion-v2`,
    name: "Yes legion",
    argues: "Yes",
    shareLabel: "Bonded",
    marketSide: 1,
    winStatus: 1,
  },
  no: {
    side: "no",
    contract: `${LEGION_DEPLOYER}.elsalvador-no-legion-v2`,
    name: "No legion",
    argues: "No",
    shareLabel: "Idle",
    marketSide: 0,
    winStatus: 2,
  },
};

export const LEGION_SIDES: readonly LegionSide[] = ["yes", "no"];

/** Every contract the chainhook watches. Keep in step with scripts/legion-chainhook.sh. */
export const LEGION_CONTRACTS: readonly string[] = LEGION_SIDES.map((s) => LEGIONS[s].contract);

export function sideOfContract(contractId: string): LegionSide | null {
  return LEGION_SIDES.find((s) => LEGIONS[s].contract === contractId) ?? null;
}

/** Governance parameters, as `get-params` returns them. */
export interface LegionParams {
  minPosition: number;
  payout: number;
  minVoters: number;
  proposerCooldown: number;
  votingThreshold: number;
  voteDelay: number;
  voteWindow: number;
  concludeWindow: number;
  globalProposeInterval: number;
}

/**
 * The source-file constants. Only a fallback: the live values come from each
 * contract's `get-params`, read once per isolate (lib/legion/chain.ts).
 */
export const FALLBACK_PARAMS: LegionParams = {
  minPosition: 1_000,
  payout: 3_000,
  minVoters: 2,
  proposerCooldown: 144,
  votingThreshold: 66,
  voteDelay: 2,
  voteWindow: 30,
  concludeWindow: 12,
  globalProposeInterval: 6,
};

/** Proposal status uint (`Proposals.status`). */
export const STATUS = { OPEN: 0, PASSED: 1, FAILED: 2, EXPIRED: 3 } as const;

/** Market status uint (`get-market`.status). */
export const MARKET_STATUS = { OPEN: 0, BONDED: 1, IDLE: 2 } as const;

/**
 * Both contracts are `PROD-BURN` builds: every window counts Bitcoin blocks.
 * Used only for countdown estimates; a phase is always a height comparison.
 */
export const BURN_BLOCK_SECONDS = 600;

/** The repo's one mainnet Hiro base, so every Stacks read shares one host. */
export { STACKS_API_BASE as HIRO_API } from "../identity/constants";

/** The agent-facing specification: how to join, propose, vote and conclude. */
export const LEGION_SKILL_HREF = "https://github.com/aibtcdev/legions/blob/main/stake/skill.md";
export const LEGION_SOURCE_HREF = "https://github.com/aibtcdev/legions/tree/main/stake";
/** Where the market itself trades. */
export const MARKET_SITE_HREF = "https://elsalvadorstakesbtc.com";

/**
 * Edge-cache lifetime of the Hiro chain reads (tip, market, vaults, proposer
 * weights). Events are never cached: they are read from D1 on every request.
 * Burn blocks land every ~10 min, so five minutes costs nothing a reader sees.
 */
export const LEGION_STATE_TTL_SECONDS = 300;

/** Live `get-weight` reads per side per rebuild, most recent participants first. */
export const MAX_MEMBER_WEIGHT_READS = 20;
