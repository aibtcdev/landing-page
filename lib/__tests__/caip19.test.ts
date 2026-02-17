import { describe, it, expect } from "vitest";
import {
  CAIP19_CHAIN_ID,
  CAIP19_ASSET_TYPE,
  buildCAIP19AgentId,
  getCAIP19AgentId,
} from "../caip19";

const IDENTITY_CONTRACT =
  "SP1NMR7MY0TJ1QA7WQBZ6504KC79PZNTRQH4YGFJD.identity-registry-v2";

describe("CAIP-19 constants", () => {
  it("CAIP19_CHAIN_ID is stacks:1", () => {
    expect(CAIP19_CHAIN_ID).toBe("stacks:1");
  });

  it("CAIP19_ASSET_TYPE is sip009", () => {
    expect(CAIP19_ASSET_TYPE).toBe("sip009");
  });
});

describe("buildCAIP19AgentId", () => {
  it("produces correct identifier for agent 0 (first agent)", () => {
    const result = buildCAIP19AgentId(0);
    expect(result).toBe(
      `stacks:1/sip009:${IDENTITY_CONTRACT}/0`
    );
  });

  it("produces correct identifier for agent 1", () => {
    const result = buildCAIP19AgentId(1);
    expect(result).toBe(
      `stacks:1/sip009:${IDENTITY_CONTRACT}/1`
    );
  });

  it("produces correct identifier for a large agent id", () => {
    const result = buildCAIP19AgentId(99);
    expect(result).toBe(
      `stacks:1/sip009:${IDENTITY_CONTRACT}/99`
    );
  });

  it("output starts with the chain identifier", () => {
    const result = buildCAIP19AgentId(5);
    expect(result.startsWith("stacks:1/sip009:")).toBe(true);
  });

  it("output includes the full identity contract address", () => {
    const result = buildCAIP19AgentId(42);
    expect(result).toContain(IDENTITY_CONTRACT);
  });

  it("output ends with the agent id", () => {
    const result = buildCAIP19AgentId(7);
    expect(result.endsWith("/7")).toBe(true);
  });

  it("handles large token ids correctly", () => {
    const result = buildCAIP19AgentId(10000);
    expect(result).toBe(
      `stacks:1/sip009:${IDENTITY_CONTRACT}/10000`
    );
  });
});

describe("getCAIP19AgentId", () => {
  it("returns null for null input", () => {
    expect(getCAIP19AgentId(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(getCAIP19AgentId(undefined)).toBeNull();
  });

  it("returns correct caip19 string for agentId 0 (valid first agent)", () => {
    // 0 is a valid agentId — it is the first registered agent
    const result = getCAIP19AgentId(0);
    expect(result).toBe(
      `stacks:1/sip009:${IDENTITY_CONTRACT}/0`
    );
  });

  it("returns correct caip19 string for agentId 1", () => {
    const result = getCAIP19AgentId(1);
    expect(result).toBe(
      `stacks:1/sip009:${IDENTITY_CONTRACT}/1`
    );
  });

  it("returns correct caip19 string for larger agentId", () => {
    const result = getCAIP19AgentId(42);
    expect(result).toBe(
      `stacks:1/sip009:${IDENTITY_CONTRACT}/42`
    );
  });

  it("output for non-null agentId starts with stacks:1/sip009:", () => {
    const result = getCAIP19AgentId(3);
    expect(result).not.toBeNull();
    expect(result!.startsWith("stacks:1/sip009:")).toBe(true);
  });

  it("output includes the identity registry contract", () => {
    const result = getCAIP19AgentId(10);
    expect(result).toContain(IDENTITY_CONTRACT);
  });
});

describe("CAIP-19 format compliance", () => {
  it("follows CAIP-19 format: namespace:reference/asset_namespace:asset_reference/token_id", () => {
    // CAIP-19 format: chain_id/asset_type:contract/token_id
    // chain_id format: namespace:reference (stacks:1)
    // asset: sip009:contract-address/tokenId
    const result = buildCAIP19AgentId(5);
    const parts = result.split("/");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("stacks:1");
    expect(parts[1]).toContain("sip009:");
    expect(parts[2]).toBe("5");
  });
});
