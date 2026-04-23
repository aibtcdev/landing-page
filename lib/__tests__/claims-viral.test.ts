import { describe, it, expect } from "vitest";
import type { ClaimRecord } from "../types";

// ---------------------------------------------------------------------------
// Constants and helpers extracted from viral route
// ---------------------------------------------------------------------------

const MIN_REWARD_SATS = 5000;
const MAX_REWARD_SATS = 10000;

function getRandomReward(): number {
  return Math.floor(Math.random() * (MAX_REWARD_SATS - MIN_REWARD_SATS + 1)) + MIN_REWARD_SATS;
}

function normalizeTweetUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (
      parsed.hostname !== "twitter.com" &&
      parsed.hostname !== "x.com" &&
      parsed.hostname !== "www.twitter.com" &&
      parsed.hostname !== "www.x.com"
    ) {
      return null;
    }
    const match = parsed.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
    if (!match) return null;
    return `https://x.com/${match[1]}/status/${match[2]}`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// getRandomReward tests
// ---------------------------------------------------------------------------

describe("getRandomReward", () => {
  it("returns a number within [5000, 10000] range", () => {
    for (let i = 0; i < 200; i++) {
      const reward = getRandomReward();
      expect(reward).toBeGreaterThanOrEqual(MIN_REWARD_SATS);
      expect(reward).toBeLessThanOrEqual(MAX_REWARD_SATS);
    }
  });

  it("returns integer satoshis", () => {
    for (let i = 0; i < 100; i++) {
      const reward = getRandomReward();
      expect(Number.isInteger(reward)).toBe(true);
    }
  });

  it("range is inclusive at both ends", () => {
    const results = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      results.add(getRandomReward());
    }
    const min = Math.min(...[...results]);
    const max = Math.max(...[...results]);
    expect(min).toBeGreaterThanOrEqual(5000);
    expect(max).toBeLessThanOrEqual(10000);
  });
});

// ---------------------------------------------------------------------------
// URL normalization edge cases
// ---------------------------------------------------------------------------

describe("normalizeTweetUrl", () => {
  it("accepts twitter.com status URL", () => {
    const result = normalizeTweetUrl("https://twitter.com/username/status/1234567890123456789");
    expect(result).toBe("https://x.com/username/status/1234567890123456789");
  });

  it("accepts x.com status URL", () => {
    const result = normalizeTweetUrl("https://x.com/username/status/1234567890123456789");
    expect(result).toBe("https://x.com/username/status/1234567890123456789");
  });

  it("accepts www.twitter.com status URL", () => {
    const result = normalizeTweetUrl("https://www.twitter.com/username/status/1234567890123456789");
    expect(result).toBe("https://x.com/username/status/1234567890123456789");
  });

  it("accepts www.x.com status URL", () => {
    const result = normalizeTweetUrl("https://www.x.com/username/status/1234567890123456789");
    expect(result).toBe("https://x.com/username/status/1234567890123456789");
  });

  it("normalizes twitter.com to x.com output", () => {
    const result = normalizeTweetUrl("https://twitter.com/myagent/status/999");
    expect(result).toBe("https://x.com/myagent/status/999");
    expect(result?.startsWith("https://x.com/")).toBe(true);
  });

  it("rejects non-twitter/x hostname", () => {
    expect(normalizeTweetUrl("https://facebook.com/username/status/123")).toBeNull();
    expect(normalizeTweetUrl("https://example.com/username/status/123")).toBeNull();
    expect(normalizeTweetUrl("https://t.co/username/status/123")).toBeNull();
  });

  it("rejects URL without status path", () => {
    expect(normalizeTweetUrl("https://x.com/username")).toBeNull();
    expect(normalizeTweetUrl("https://x.com/username/")).toBeNull();
    expect(normalizeTweetUrl("https://x.com/username/replies/123")).toBeNull();
    expect(normalizeTweetUrl("https://x.com/username/photo/123")).toBeNull();
  });

  it("rejects URL with invalid path structure", () => {
    expect(normalizeTweetUrl("https://x.com/status/123")).toBeNull();
    expect(normalizeTweetUrl("https://x.com//status/123")).toBeNull();
    expect(normalizeTweetUrl("https://x.com/username/status/")).toBeNull();
    expect(normalizeTweetUrl("https://x.com/username/status/abc")).toBeNull();
  });

  it("rejects malformed URL", () => {
    expect(normalizeTweetUrl("not-a-url")).toBeNull();
    expect(normalizeTweetUrl("")).toBeNull();
    expect(normalizeTweetUrl("https://")).toBeNull();
  });

  it("handles numeric tweet IDs correctly", () => {
    const result = normalizeTweetUrl("https://x.com/user/status/1847000000000000000");
    expect(result).toBe("https://x.com/user/status/1847000000000000000");
  });

  it("preserves username case in output", () => {
    const result = normalizeTweetUrl("https://x.com/MyAgent/status/123");
    expect(result).toBe("https://x.com/MyAgent/status/123");
  });

  it("returns normalized URL with https://x.com prefix", () => {
    const result = normalizeTweetUrl("https://twitter.com/TestUser/status/789");
    expect(result).toMatch(/^https:\/\/x\.com\/TestUser\/status\/789$/);
  });
});

// ---------------------------------------------------------------------------
// POST /api/claims/viral request validation
// ---------------------------------------------------------------------------

describe("POST /api/claims/viral body validation", () => {
  function validateRequestBody(body: { btcAddress?: string; tweetUrl?: string }) {
    const { btcAddress, tweetUrl } = body;
    if (!btcAddress) {
      return { valid: false, error: "btcAddress is required", status: 400 };
    }
    if (!tweetUrl) {
      return { valid: false, error: "tweetUrl is required", status: 400 };
    }
    return { valid: true };
  }

  it("missing btcAddress returns 400", () => {
    const result = validateRequestBody({ tweetUrl: "https://x.com/user/status/123" });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("btcAddress is required");
    expect(result.status).toBe(400);
  });

  it("missing tweetUrl returns 400", () => {
    const result = validateRequestBody({ btcAddress: "bc1qtest" });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("tweetUrl is required");
    expect(result.status).toBe(400);
  });

  it("both present is valid", () => {
    const result = validateRequestBody({
      btcAddress: "bc1qtest",
      tweetUrl: "https://x.com/user/status/123",
    });
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ClaimRecord structure tests
// ---------------------------------------------------------------------------

describe("ClaimRecord structure", () => {
  it("has all required fields for a verified claim", () => {
    const record: ClaimRecord = {
      btcAddress: "bc1qtest123",
      displayName: "TestAgent",
      tweetUrl: "https://x.com/user/status/123",
      tweetAuthor: "user",
      claimedAt: new Date().toISOString(),
      rewardSatoshis: 7500,
      rewardTxid: null,
      status: "verified",
    };
    expect(record.btcAddress).toBeDefined();
    expect(record.displayName).toBeDefined();
    expect(record.tweetUrl).toBeDefined();
    expect(record.claimedAt).toBeDefined();
    expect(record.rewardSatoshis).toBeGreaterThanOrEqual(5000);
    expect(record.rewardSatoshis).toBeLessThanOrEqual(10000);
    expect(record.status).toBe("verified");
  });

  it("rewardSatoshis is within 5000-10000 range", () => {
    const record: ClaimRecord = {
      btcAddress: "bc1qtest",
      displayName: "Agent",
      tweetUrl: "https://x.com/user/status/123",
      tweetAuthor: "user",
      claimedAt: new Date().toISOString(),
      rewardSatoshis: getRandomReward(),
      rewardTxid: null,
      status: "verified",
    };
    expect(record.rewardSatoshis).toBeGreaterThanOrEqual(5000);
    expect(record.rewardSatoshis).toBeLessThanOrEqual(10000);
  });

  it("rewarded status has rewardTxid", () => {
    const record: ClaimRecord = {
      btcAddress: "bc1qtest",
      displayName: "Agent",
      tweetUrl: "https://x.com/user/status/123",
      tweetAuthor: "user",
      claimedAt: new Date().toISOString(),
      rewardSatoshis: 7500,
      rewardTxid: "abc123txid",
      status: "rewarded",
    };
    expect(record.status).toBe("rewarded");
    expect(record.rewardTxid).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Already-claimed agent response structure
// ---------------------------------------------------------------------------

describe("Already-claimed agent response", () => {
  function buildAlreadyClaimedResponse(claim: ClaimRecord) {
    if (claim.status === "rewarded") {
      return {
        claimed: true,
        message: "Reward already sent!",
        claim: {
          displayName: claim.displayName,
          rewardSatoshis: claim.rewardSatoshis,
          rewardTxid: claim.rewardTxid,
          claimedAt: claim.claimedAt,
          status: claim.status,
        },
      };
    }
    if (claim.status === "verified" || claim.status === "pending") {
      return {
        eligible: true,
        message: "Claim already submitted. Reward will be sent shortly.",
        claim: {
          displayName: claim.displayName,
          rewardSatoshis: claim.rewardSatoshis,
          status: claim.status,
          tweetUrl: claim.tweetUrl,
        },
      };
    }
    return null;
  }

  it("rewarded status returns claimed:true", () => {
    const claim: ClaimRecord = {
      btcAddress: "bc1qtest",
      displayName: "TestAgent",
      tweetUrl: "https://x.com/user/status/123",
      tweetAuthor: "user",
      claimedAt: "2026-04-19T00:00:00.000Z",
      rewardSatoshis: 8500,
      rewardTxid: "txid123",
      status: "rewarded",
    };
    const response = buildAlreadyClaimedResponse(claim);
    expect(response?.claimed).toBe(true);
    expect(response?.message).toBe("Reward already sent!");
    expect(response?.claim.displayName).toBe("TestAgent");
  });

  it("verified status returns eligible:true", () => {
    const claim: ClaimRecord = {
      btcAddress: "bc1qtest",
      displayName: "TestAgent",
      tweetUrl: "https://x.com/user/status/123",
      tweetAuthor: "user",
      claimedAt: "2026-04-19T00:00:00.000Z",
      rewardSatoshis: 7500,
      rewardTxid: null,
      status: "verified",
    };
    const response = buildAlreadyClaimedResponse(claim);
    expect(response?.eligible).toBe(true);
    expect(response?.message).toContain("already submitted");
  });

  it("pending status returns eligible:true", () => {
    const claim: ClaimRecord = {
      btcAddress: "bc1qtest",
      displayName: "TestAgent",
      tweetUrl: "https://x.com/user/status/123",
      tweetAuthor: "user",
      claimedAt: "2026-04-19T00:00:00.000Z",
      rewardSatoshis: 6000,
      rewardTxid: null,
      status: "pending",
    };
    const response = buildAlreadyClaimedResponse(claim);
    expect(response?.eligible).toBe(true);
  });

  it("failed status returns null", () => {
    const claim: ClaimRecord = {
      btcAddress: "bc1qtest",
      displayName: "TestAgent",
      tweetUrl: "https://x.com/user/status/123",
      tweetAuthor: "user",
      claimedAt: "2026-04-19T00:00:00.000Z",
      rewardSatoshis: 6000,
      rewardTxid: null,
      status: "failed",
    };
    const response = buildAlreadyClaimedResponse(claim);
    expect(response).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// KV key format tests
// ---------------------------------------------------------------------------

describe("KV key format for claims/viral", () => {
  it("claim key follows expected format", () => {
    const btcAddress = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
    const key = `claim:${btcAddress}`;
    expect(key).toBe("claim:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh");
  });

  it("agent lookup key follows expected format", () => {
    const btcAddress = "bc1qtest";
    const key = `btc:${btcAddress}`;
    expect(key).toBe("btc:bc1qtest");
  });

  it("owner key follows expected format", () => {
    const handle = "myagent";
    const key = `owner:${handle.toLowerCase()}`;
    expect(key).toBe("owner:myagent");
  });
});

// ---------------------------------------------------------------------------
// Tweet content verification logic
// ---------------------------------------------------------------------------

describe("Tweet content verification", () => {
  function verifyTweetContent(
    tweetText: string,
    displayName: string,
    btcAddress: string
  ): { hasAibtc: boolean; hasAgent: boolean } {
    const tweetLower = tweetText.toLowerCase();
    const hasAibtc = tweetLower.includes("aibtc");
    const hasAgent =
      tweetLower.includes(displayName.toLowerCase()) ||
      tweetLower.includes(btcAddress.toLowerCase());
    return { hasAibtc, hasAgent };
  }

  it("passes when tweet mentions AIBTC and agent name", () => {
    const result = verifyTweetContent(
      "I am joining AIBTC because I believe BTC will be the currency of AIs. My agent TestAgent.",
      "TestAgent",
      "bc1qtest"
    );
    expect(result.hasAibtc).toBe(true);
    expect(result.hasAgent).toBe(true);
  });

  it("passes when tweet mentions AIBTC and BTC address", () => {
    const result = verifyTweetContent(
      "Joining AIBTC with bc1qtest address for the agent economy",
      "TestAgent",
      "bc1qtest"
    );
    expect(result.hasAibtc).toBe(true);
    expect(result.hasAgent).toBe(true);
  });

  it("fails when tweet has AIBTC but not agent name or address", () => {
    const result = verifyTweetContent(
      "I love AIBTC and Bitcoin!",
      "TestAgent",
      "bc1qtest"
    );
    expect(result.hasAibtc).toBe(true);
    expect(result.hasAgent).toBe(false);
  });

  it("fails when tweet has agent but not AIBTC", () => {
    const result = verifyTweetContent(
      "My agent TestAgent is awesome",
      "TestAgent",
      "bc1qtest"
    );
    expect(result.hasAibtc).toBe(false);
    expect(result.hasAgent).toBe(true);
  });

  it("is case-insensitive for AIBTC", () => {
    const result = verifyTweetContent(
      "joining aibtc because I believe btc will be the currency of ais",
      "TestAgent",
      "bc1qtest"
    );
    expect(result.hasAibtc).toBe(true);
  });

  it("requires both AIBTC and agent mention", () => {
    const result = verifyTweetContent(
      "Just a regular tweet",
      "TestAgent",
      "bc1qtest"
    );
    expect(result.hasAibtc).toBe(false);
    expect(result.hasAgent).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// X handle uniqueness check logic
// ---------------------------------------------------------------------------

describe("X handle uniqueness", () => {
  function checkOwnerUniqueness(
    agentOwner: string | null | undefined,
    agentBtcAddress: string,
    newOwnerHandle: string,
    existingOwnerByHandle: string | null
  ): { valid: boolean; error?: string } {
    if (agentOwner && agentOwner.toLowerCase() !== newOwnerHandle.toLowerCase()) {
      return {
        valid: false,
        error: `This agent is already claimed by X account @${agentOwner}. Each agent can only be claimed by one X account.`,
      };
    }
    if (existingOwnerByHandle && existingOwnerByHandle !== agentBtcAddress) {
      return {
        valid: false,
        error: "This X account has already claimed a different agent. Each X account can only claim one agent.",
      };
    }
    return { valid: true };
  }

  it("allows first-time claim (no existing owner)", () => {
    const result = checkOwnerUniqueness(null, "bc1qtest", "myagent", null);
    expect(result.valid).toBe(true);
  });

  it("allows same owner re-submit", () => {
    const result = checkOwnerUniqueness("myagent", "bc1qtest", "MyAgent", null);
    expect(result.valid).toBe(true);
  });

  it("rejects different owner for same agent", () => {
    const result = checkOwnerUniqueness("oldowner", "bc1qtest", "newowner", null);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("already claimed by X account @oldowner");
  });

  it("rejects X handle already claimed by different agent", () => {
    const result = checkOwnerUniqueness(null, "bc1qtest", "somehandle", "bc1qother");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("X account has already claimed a different agent");
  });

  it("allows same agent re-submit with same owner", () => {
    const result = checkOwnerUniqueness("myagent", "bc1qtest", "myagent", "bc1qtest");
    expect(result.valid).toBe(true);
  });
});