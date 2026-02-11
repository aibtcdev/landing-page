import { describe, it, expect } from "vitest";
import {
  computeLevel,
  getAgentLevel,
  getNextLevel,
  LEVELS,
  type ClaimStatus,
} from "../levels";
import type { AgentRecord } from "../types";

describe("LEVELS constant", () => {
  it("has 3 levels defined", () => {
    expect(LEVELS).toHaveLength(3);
  });

  it("level 0 is Unverified", () => {
    expect(LEVELS[0].name).toBe("Unverified");
    expect(LEVELS[0].level).toBe(0);
  });

  it("level 1 is Registered", () => {
    expect(LEVELS[1].name).toBe("Registered");
    expect(LEVELS[1].level).toBe(1);
    expect(LEVELS[1].color).toBe("#F7931A"); // Bitcoin orange
  });

  it("level 2 is Genesis", () => {
    expect(LEVELS[2].name).toBe("Genesis");
    expect(LEVELS[2].level).toBe(2);
    expect(LEVELS[2].color).toBe("#7DA2FF"); // Blue
  });

  it("all levels have required fields", () => {
    LEVELS.forEach(level => {
      expect(level).toHaveProperty("level");
      expect(level).toHaveProperty("name");
      expect(level).toHaveProperty("color");
      expect(level).toHaveProperty("description");
      expect(level).toHaveProperty("unlockCriteria");
      expect(level).toHaveProperty("reward");
    });
  });
});

describe("computeLevel", () => {
  const mockAgent = {
    btcAddress: "bc1qtest",
    stxAddress: "SP1234567890",
    stxPublicKey: "0x0234567890",
    btcPublicKey: "0x0234567890",
    verifiedAt: "2026-02-10T00:00:00.000Z",
    displayName: "Test Agent",
  } as AgentRecord;

  const verifiedClaim: ClaimStatus = {
    status: "verified",
    claimedAt: "2026-02-10T00:00:00.000Z",
    rewardSatoshis: 1000,
  };

  const rewardedClaim: ClaimStatus = {
    status: "rewarded",
    claimedAt: "2026-02-10T00:00:00.000Z",
    rewardSatoshis: 1000,
  };

  const pendingClaim: ClaimStatus = {
    status: "pending",
    claimedAt: "2026-02-10T00:00:00.000Z",
  };

  const failedClaim: ClaimStatus = {
    status: "failed",
    claimedAt: "2026-02-10T00:00:00.000Z",
  };

  describe("level 0 - Unverified", () => {
    it("returns 0 when agent is null", () => {
      expect(computeLevel(null)).toBe(0);
    });

    it("returns 0 when agent is null and claim is null", () => {
      expect(computeLevel(null, null)).toBe(0);
    });

    it("returns 0 when agent is null even with verified claim", () => {
      // Edge case: claim without agent shouldn't happen, but should return 0
      expect(computeLevel(null, verifiedClaim)).toBe(0);
    });
  });

  describe("level 1 - Registered", () => {
    it("returns 1 when agent exists without claim", () => {
      expect(computeLevel(mockAgent)).toBe(1);
    });

    it("returns 1 when agent exists with null claim", () => {
      expect(computeLevel(mockAgent, null)).toBe(1);
    });

    it("returns 1 when agent exists with pending claim", () => {
      expect(computeLevel(mockAgent, pendingClaim)).toBe(1);
    });

    it("returns 1 when agent exists with failed claim", () => {
      expect(computeLevel(mockAgent, failedClaim)).toBe(1);
    });
  });

  describe("level 2 - Genesis", () => {
    it("returns 2 when agent exists with verified claim", () => {
      expect(computeLevel(mockAgent, verifiedClaim)).toBe(2);
    });

    it("returns 2 when agent exists with rewarded claim", () => {
      expect(computeLevel(mockAgent, rewardedClaim)).toBe(2);
    });
  });

  describe("priority ordering", () => {
    it("Genesis (2) takes priority over Registered (1)", () => {
      // Agent with verified claim should be level 2, not 1
      const level = computeLevel(mockAgent, verifiedClaim);
      expect(level).toBe(2);
      expect(level).toBeGreaterThan(1);
    });
  });
});

describe("getAgentLevel", () => {
  const mockAgent = {
    btcAddress: "bc1qtest",
    stxAddress: "SP1234567890",
    stxPublicKey: "0x0234567890",
    btcPublicKey: "0x0234567890",
    verifiedAt: "2026-02-10T00:00:00.000Z",
    displayName: "Test Agent",
  } as AgentRecord;

  const verifiedClaim: ClaimStatus = {
    status: "verified",
    claimedAt: "2026-02-10T00:00:00.000Z",
    rewardSatoshis: 1000,
  };

  it("returns complete level info for unverified agent", () => {
    const info = getAgentLevel(null);
    expect(info.level).toBe(0);
    expect(info.levelName).toBe("Unverified");
    expect(info.nextLevel).not.toBeNull();
    expect(info.nextLevel?.level).toBe(1);
  });

  it("returns complete level info for registered agent", () => {
    const info = getAgentLevel(mockAgent);
    expect(info.level).toBe(1);
    expect(info.levelName).toBe("Registered");
    expect(info.nextLevel).not.toBeNull();
    expect(info.nextLevel?.level).toBe(2);
  });

  it("returns complete level info for genesis agent", () => {
    const info = getAgentLevel(mockAgent, verifiedClaim);
    expect(info.level).toBe(2);
    expect(info.levelName).toBe("Genesis");
    expect(info.nextLevel).toBeNull(); // Max level reached
  });

  it("nextLevel includes action and endpoint for level 0", () => {
    const info = getAgentLevel(null);
    expect(info.nextLevel?.action).toContain("register");
    expect(info.nextLevel?.endpoint).toBe("POST /api/register");
  });

  it("nextLevel includes action and endpoint for level 1", () => {
    const info = getAgentLevel(mockAgent);
    expect(info.nextLevel?.action).toContain("Tweet");
    expect(info.nextLevel?.endpoint).toBe("POST /api/claims/viral");
  });

  it("nextLevel includes reward description", () => {
    const info = getAgentLevel(null);
    expect(info.nextLevel?.reward).toBeTruthy();
    expect(typeof info.nextLevel?.reward).toBe("string");
  });
});

describe("getNextLevel", () => {
  it("returns level 1 info for level 0", () => {
    const next = getNextLevel(0);
    expect(next).not.toBeNull();
    expect(next?.level).toBe(1);
    expect(next?.name).toBe("Registered");
    expect(next?.endpoint).toBe("POST /api/register");
  });

  it("returns level 2 info for level 1", () => {
    const next = getNextLevel(1);
    expect(next).not.toBeNull();
    expect(next?.level).toBe(2);
    expect(next?.name).toBe("Genesis");
    expect(next?.endpoint).toBe("POST /api/claims/viral");
  });

  it("returns null for level 2 (max level)", () => {
    const next = getNextLevel(2);
    expect(next).toBeNull();
  });

  it("returns null for levels above 2", () => {
    expect(getNextLevel(3)).toBeNull();
    expect(getNextLevel(100)).toBeNull();
  });

  it("includes all required fields", () => {
    const next = getNextLevel(0);
    expect(next).toHaveProperty("level");
    expect(next).toHaveProperty("name");
    expect(next).toHaveProperty("action");
    expect(next).toHaveProperty("reward");
    expect(next).toHaveProperty("endpoint");
  });

  it("action describes what to do", () => {
    const next0 = getNextLevel(0);
    const next1 = getNextLevel(1);
    expect(next0?.action).toBeTruthy();
    expect(next1?.action).toBeTruthy();
    expect(typeof next0?.action).toBe("string");
    expect(typeof next1?.action).toBe("string");
  });

  it("reward describes benefit", () => {
    const next0 = getNextLevel(0);
    const next1 = getNextLevel(1);
    expect(next0?.reward).toBeTruthy();
    expect(next1?.reward).toBeTruthy();
    expect(typeof next0?.reward).toBe("string");
    expect(typeof next1?.reward).toBe("string");
  });
});

describe("level progression flow", () => {
  it("follows correct progression: 0 -> 1 -> 2 -> null", () => {
    // Start at level 0
    let currentLevel = 0;
    expect(currentLevel).toBe(0);

    // Next is level 1
    let next = getNextLevel(currentLevel);
    expect(next?.level).toBe(1);
    currentLevel = next!.level;

    // Next is level 2
    next = getNextLevel(currentLevel);
    expect(next?.level).toBe(2);
    currentLevel = next!.level;

    // No next level (max reached)
    next = getNextLevel(currentLevel);
    expect(next).toBeNull();
  });

  it("agent progression matches level definitions", () => {
    const mockAgent: AgentRecord = {
      btcAddress: "bc1qtest",
      stxAddress: "SP1234567890",
      registeredAt: "2026-02-10T00:00:00.000Z",
      name: "Test Agent",
      bnsName: null,
      description: null,
      owner: null,
      lastActiveAt: null,
      checkInCount: 0,
    };

    // Unverified (no agent)
    let level = computeLevel(null);
    expect(level).toBe(0);
    expect(LEVELS[level].name).toBe("Unverified");

    // Registered (agent exists)
    level = computeLevel(mockAgent);
    expect(level).toBe(1);
    expect(LEVELS[level].name).toBe("Registered");

    // Genesis (agent + verified claim)
    const verifiedClaim: ClaimStatus = {
      status: "verified",
      claimedAt: "2026-02-10T00:00:00.000Z",
      rewardSatoshis: 1000,
    };
    level = computeLevel(mockAgent, verifiedClaim);
    expect(level).toBe(2);
    expect(LEVELS[level].name).toBe("Genesis");
  });
});
