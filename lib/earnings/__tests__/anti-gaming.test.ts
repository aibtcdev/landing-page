import { describe, it, expect, vi } from "vitest";
import { applyAntiGaming } from "../anti-gaming";
import type { Classification, InboundTransfer } from "../types";

const SENDER = "SP_SENDER";
const RECIPIENT = "SP_RECIPIENT";

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as import("../../logging").Logger;

function transfer(overrides: Partial<InboundTransfer> = {}): InboundTransfer {
  return {
    txId: "0xtx",
    eventIndex: 0,
    senderStx: SENDER,
    recipientAgentStx: RECIPIENT,
    asset: "sbtc",
    amountRaw: 1000,
    stxBlockHeight: 100,
    blockTime: 1_000_000,
    ...overrides,
  };
}

const peerEarning: Classification = {
  sourceClass: "agent_peer",
  sourceSubclass: null,
  excludedReason: null,
  isEarning: true,
};

interface DbConfig {
  override?: { action: string; new_source_class: string | null } | null;
  sameOwner?: boolean;
  firstFunder?: Record<string, string>;
  reverseLeg?: { tx_id: string; event_index: number } | null;
  onUpdate?: () => void;
}

function makeDb(config: DbConfig) {
  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (sql.includes("earnings_manual_override")) return config.override ?? null;
          if (sql.includes("JOIN agents")) return config.sameOwner ? { x: 1 } : null;
          if (sql.includes("address_first_funder")) {
            const addr = args[0] as string;
            const f = config.firstFunder?.[addr];
            return f
              ? { first_funder_stx: f, lookup_status: "ok", fetched_at: 0 }
              : { first_funder_stx: null, lookup_status: "none", fetched_at: 0 };
          }
          if (sql.includes("FROM agent_earnings")) return config.reverseLeg ?? null;
          return null;
        },
        run: async () => {
          if (sql.startsWith("UPDATE agent_earnings")) config.onUpdate?.();
          return { meta: { changes: 1 } };
        },
      }),
    }),
  } as unknown as D1Database;
}

function env(db: D1Database) {
  return { DB: db, VERIFIED_AGENTS: {} as KVNamespace, HIRO_API_KEY: undefined };
}

describe("applyAntiGaming — manual override", () => {
  it("exclude forces excluded_manual", async () => {
    const db = makeDb({ override: { action: "exclude", new_source_class: null } });
    const c = await applyAntiGaming(env(db), transfer(), peerEarning, 0, noopLogger);
    expect(c).toMatchObject({ excludedReason: "excluded_manual", isEarning: false });
  });

  it("include forces an earning even on a non-earning input", async () => {
    const db = makeDb({ override: { action: "include", new_source_class: null } });
    const excluded: Classification = { ...peerEarning, isEarning: false, excludedReason: "unclassified" };
    const c = await applyAntiGaming(env(db), transfer(), excluded, 0, noopLogger);
    expect(c).toMatchObject({ excludedReason: null, isEarning: true });
  });

  it("reclassify to an earning class", async () => {
    const db = makeDb({ override: { action: "reclassify", new_source_class: "bounty" } });
    const c = await applyAntiGaming(env(db), transfer(), peerEarning, 0, noopLogger);
    expect(c).toMatchObject({ sourceClass: "bounty", isEarning: true });
  });
});

describe("applyAntiGaming — heuristics (agent_peer only)", () => {
  it("passes a non-agent_peer earning through untouched", async () => {
    const db = makeDb({ sameOwner: true }); // would exclude if it ran
    const inbox: Classification = { sourceClass: "inbox_message", sourceSubclass: "m1", excludedReason: null, isEarning: true };
    const c = await applyAntiGaming(env(db), transfer(), inbox, 0, noopLogger);
    expect(c).toEqual(inbox);
  });

  it("excludes when sender + recipient share an owner (alt-address)", async () => {
    const db = makeDb({ sameOwner: true });
    const c = await applyAntiGaming(env(db), transfer(), peerEarning, 0, noopLogger);
    expect(c).toMatchObject({ excludedReason: "self_funded", isEarning: false });
  });

  it("excludes when sender + recipient share a first-funder", async () => {
    const db = makeDb({ firstFunder: { [SENDER]: "SP_FUNDER", [RECIPIENT]: "SP_FUNDER" } });
    const c = await applyAntiGaming(env(db), transfer(), peerEarning, 0, noopLogger);
    expect(c).toMatchObject({ excludedReason: "self_funded", isEarning: false });
  });

  it("does NOT exclude when first-funders differ", async () => {
    const db = makeDb({ firstFunder: { [SENDER]: "SP_A", [RECIPIENT]: "SP_B" } });
    const c = await applyAntiGaming(env(db), transfer(), peerEarning, 0, noopLogger);
    expect(c).toEqual(peerEarning);
  });

  it("excludes a ring and flags the reverse leg", async () => {
    const onUpdate = vi.fn();
    const db = makeDb({ reverseLeg: { tx_id: "0xreverse", event_index: 2 }, onUpdate });
    const c = await applyAntiGaming(env(db), transfer(), peerEarning, 0, noopLogger);
    expect(c).toMatchObject({ excludedReason: "ring", isEarning: false });
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it("passes a clean agent_peer earning through", async () => {
    const db = makeDb({}); // no override, no shared owner, no funders, no reverse leg
    const c = await applyAntiGaming(env(db), transfer(), peerEarning, 0, noopLogger);
    expect(c).toEqual(peerEarning);
  });
});
