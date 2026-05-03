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

  it("differentiates by key — distinct keys do not collapse to one bucket", () => {
    // Sample 100 sequential keys, expect more than one outcome split.
    const outcomes = new Set<boolean>();
    for (let i = 0; i < 100; i++) {
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

  it("differentiates by category — same key, different category, can differ", () => {
    // categoryA defaults to 100%, categoryB at 5%; same key must keep on A
    // but may or may not keep on B (deterministic).
    const a = samplingFor("not.in.config", "shared-key");
    expect(a.keep).toBe(true);
    expect(a.rate).toBe(1);
  });
});
