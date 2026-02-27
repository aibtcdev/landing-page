import { describe, it, expect } from "vitest";
import { deriveNpub, encodeNpub, validateNostrPubkey } from "../nostr";

describe("validateNostrPubkey", () => {
  it("returns true for valid 64-char lowercase hex", function () {
    expect(
      validateNostrPubkey(
        "2b4603d231d15f771ded3e6c1ee250d79bd9a8950dbaf2e76015d5bb5c65e198"
      )
    ).toBe(true);
  });

  it("returns false for 63-char string", function () {
    expect(
      validateNostrPubkey(
        "2b4603d231d15f771ded3e6c1ee250d79bd9a8950dbaf2e76015d5bb5c65e19"
      )
    ).toBe(false);
  });

  it("returns false for 65-char string", function () {
    expect(
      validateNostrPubkey(
        "2b4603d231d15f771ded3e6c1ee250d79bd9a8950dbaf2e76015d5bb5c65e1980"
      )
    ).toBe(false);
  });

  it("returns false for uppercase hex", function () {
    expect(
      validateNostrPubkey(
        "2B4603D231D15F771DED3E6C1EE250D79BD9A8950DBAF2E76015D5BB5C65E198"
      )
    ).toBe(false);
  });

  it("returns false for empty string", function () {
    expect(validateNostrPubkey("")).toBe(false);
  });

  it("returns false for null", function () {
    expect(validateNostrPubkey(null as unknown as string)).toBe(false);
  });

  it("returns false for undefined", function () {
    expect(validateNostrPubkey(undefined as unknown as string)).toBe(false);
  });
});

describe("encodeNpub", () => {
  it("encodes valid 64-char hex to npub1... string", function () {
    const npub = encodeNpub(
      "2b4603d231d15f771ded3e6c1ee250d79bd9a8950dbaf2e76015d5bb5c65e198"
    );
    expect(npub).toBe(
      "npub19drq8533690hw80d8ekpacjs67dan2y4pka09emqzh2mkhr9uxvqd4k3nn"
    );
  });

  it("returns null for 63-char input", function () {
    expect(
      encodeNpub(
        "2b4603d231d15f771ded3e6c1ee250d79bd9a8950dbaf2e76015d5bb5c65e19"
      )
    ).toBeNull();
  });

  it("returns null for uppercase hex", function () {
    expect(
      encodeNpub(
        "2B4603D231D15F771DED3E6C1EE250D79BD9A8950DBAF2E76015D5BB5C65E198"
      )
    ).toBeNull();
  });
});

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
