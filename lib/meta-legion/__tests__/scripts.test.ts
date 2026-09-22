import { describe, it, expect } from "vitest";
import { describeScript } from "../scripts";

describe("describeScript", () => {
  it("names the genesis pay-to-pubkey output", () => {
    const v = describeScript(
      "0x4104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac"
    );
    expect(v).toMatchObject({ address: null, label: "Genesis output (pay-to-pubkey)" });
  });

  it("decodes P2PKH to the genesis address", () => {
    expect(describeScript("0x76a91462e907b15cbf27d5425399ebf6f0fb50ebb88f1888ac").address).toBe(
      "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
    );
  });

  it("decodes segwit and taproot", () => {
    expect(describeScript("0x0014751e76e8199196d454941c45d1b3a323f1433bd6").address).toBe(
      "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
    );
    expect(
      describeScript("0x5120a60869f0dbcf1dc659c9cecbaf8050135ea9e8cdc487053f1dc6880949dc684c").address
    ).toBe("bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr");
  });

  it("falls back for an unknown script", () => {
    expect(describeScript("0x6a0401020304").address).toBeNull();
  });
});
