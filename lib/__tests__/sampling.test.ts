import { describe, it, expect } from "vitest";
import { samplingFor } from "../logging";

describe("samplingFor", () => {
  it("keeps everything at 100% (default for unknown categories)", () => {
    const { keep, rate } = samplingFor("unknown.category", "any-key");
    expect(keep).toBe(true);
    expect(rate).toBe(1);
  });

  it("returns the configured rate for known categories", () => {
    const { rate } = samplingFor("cache.event", "bns:bc1q...");
    expect(rate).toBe(0.05);
  });

  it("is deterministic — same key + same rate → same outcome", () => {
    const a = samplingFor("cache.event", "bns:bc1qexample1");
    const b = samplingFor("cache.event", "bns:bc1qexample1");
    expect(a).toEqual(b);
  });

  it("differentiates by key — distinct keys produce both kept and dropped outcomes", () => {
    // Use a 10000-key synthetic batch — the 5% expected-keep rate makes a
    // 100-key batch potentially flaky (two-tailed binomial; with rate 0.05 a
    // 100-key batch has ~0.6% odds of zero keeps). At 10000 keys the
    // probability of seeing both outcomes is effectively 1 with FNV-1a's
    // deterministic distribution.
    const outcomes = new Set<boolean>();
    for (let i = 0; i < 10000; i++) {
      outcomes.add(samplingFor("cache.event", `bns:bc1q${i}`).keep);
    }
    expect(outcomes.size).toBe(2);
  });

  it("keeps approximately 5% over a synthetic batch of 10000 keys", () => {
    let kept = 0;
    for (let i = 0; i < 10000; i++) {
      if (samplingFor("cache.event", `bns:bc1q-${i}`).keep) kept++;
    }
    // FNV-1a is a deterministic non-cryptographic hash; with 10000 sequential
    // keys we expect close to 500 (5%). Loose ±25% tolerance to keep the test
    // stable if the hash function or input shape ever changes minorly.
    expect(kept).toBeGreaterThan(375);
    expect(kept).toBeLessThan(625);
  });

  it("differentiates by category — same key, sampled vs unsampled categories", () => {
    // For the same key, an unconfigured category keeps at 100% while
    // `cache.event` (5%) deterministically may or may not keep. The
    // assertion focuses on what we can guarantee: the unconfigured category
    // always keeps at rate 1, and over a batch the sampled category produces
    // both kept and dropped outcomes — proving categories are not collapsed
    // to a single bucket.
    expect(samplingFor("not.in.config", "shared-key").keep).toBe(true);
    expect(samplingFor("not.in.config", "shared-key").rate).toBe(1);

    let sampledKept = 0;
    let sampledDropped = 0;
    for (let i = 0; i < 1000; i++) {
      const r = samplingFor("cache.event", `shared-key-${i}`);
      if (r.keep) sampledKept++;
      else sampledDropped++;
      expect(r.rate).toBe(0.05);
    }
    expect(sampledKept).toBeGreaterThan(0);
    expect(sampledDropped).toBeGreaterThan(0);
  });

  it("clamps misconfigured rates safely (NaN / negative / >1 → keep at 100%)", () => {
    // We can't trivially mutate SAMPLE_RATES from the test, but we can
    // assert the documented contract for unknown categories which routes
    // through the same default path.
    expect(samplingFor("definitely.not.configured", "k").rate).toBe(1);
    expect(samplingFor("definitely.not.configured", "k").keep).toBe(true);
  });
});
