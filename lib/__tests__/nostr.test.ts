import { describe, it, expect } from "vitest";
import { deriveNpub } from "../nostr";

describe("deriveNpub", () => {
  it("derives correct npub from compressed pubkey", () => {
    const npub = deriveNpub(
      "032b4603d231d15f771ded3e6c1ee250d79bd9a8950dbaf2e76015d5bb5c65e198"
    );
    expect(npub).toBe(
      "npub19drq8533690hw80d8ekpacjs67dan2y4pka09emqzh2mkhr9uxvqd4k3nn"
    );
  });

  it("works with 03 prefix keys", () => {
    const npub = deriveNpub(
      "03ff2962f3ac2a2c055536ecb4e0d7cc89c0e192467c0b73a56e1a72c92b123456"
    );
    expect(npub).not.toBeNull();
    expect(npub).toMatch(/^npub1/);
  });

  it("returns null for empty string", () => {
    expect(deriveNpub("")).toBeNull();
  });

  it("returns null for wrong length", () => {
    expect(deriveNpub("032b4603")).toBeNull();
  });

  it("returns null for uncompressed key (04 prefix)", () => {
    expect(
      deriveNpub(
        "042b4603d231d15f771ded3e6c1ee250d79bd9a8950dbaf2e76015d5bb5c65e198"
      )
    ).toBeNull();
  });

  it("returns null for null/undefined", () => {
    expect(deriveNpub(null as unknown as string)).toBeNull();
    expect(deriveNpub(undefined as unknown as string)).toBeNull();
  });
});
