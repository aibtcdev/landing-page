import { describe, it, expect } from "vitest";
import { tokenIdToTeneroAddress } from "../prices";

describe("tokenIdToTeneroAddress", () => {
  it("passes the literal 'stx' through unchanged", () => {
    expect(tokenIdToTeneroAddress("stx")).toBe("stx");
  });

  it("strips the ::asset suffix from a fully-qualified asset id", () => {
    const sbtc =
      "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token";
    expect(tokenIdToTeneroAddress(sbtc)).toBe(
      "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token"
    );
  });

  it("returns a bare contract id unchanged when there's no asset suffix", () => {
    const bare = "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token";
    expect(tokenIdToTeneroAddress(bare)).toBe(bare);
  });
});
