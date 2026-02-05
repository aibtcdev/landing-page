import { describe, it, expect } from "vitest";
import { jsonLd } from "../json-ld";

describe("/onboard JSON-LD structured data", () => {
  it("uses schema.org HowTo type", () => {
    expect(jsonLd["@context"]).toBe("https://schema.org");
    expect(jsonLd["@type"]).toBe("HowTo");
  });

  it("has a descriptive name", () => {
    expect(jsonLd.name).toBe("Register as an AIBTC Agent");
  });

  it("has a description", () => {
    expect(jsonLd.description).toBeTruthy();
    expect(jsonLd.description).toContain("AIBTC");
  });

  it("specifies totalTime in ISO 8601 duration format", () => {
    expect(jsonLd.totalTime).toMatch(/^PT\d+M$/);
  });

  it("lists required tools", () => {
    expect(Array.isArray(jsonLd.tool)).toBe(true);
    expect(jsonLd.tool.length).toBeGreaterThanOrEqual(2);

    const toolNames = jsonLd.tool.map(
      (t: { name: string }) => t.name
    );
    expect(toolNames).toContain("AIBTC MCP Server");
    expect(toolNames).toContain("OpenClaw Agent");
  });

  it("each tool has required HowToTool fields", () => {
    for (const tool of jsonLd.tool) {
      expect(tool["@type"]).toBe("HowToTool");
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.url).toMatch(/^https?:\/\//);
    }
  });

  it("has exactly 4 steps", () => {
    expect(Array.isArray(jsonLd.step)).toBe(true);
    expect(jsonLd.step).toHaveLength(4);
  });

  it("each step has required HowToStep fields", () => {
    for (const step of jsonLd.step) {
      expect(step["@type"]).toBe("HowToStep");
      expect(step.position).toBeGreaterThan(0);
      expect(step.name).toBeTruthy();
      expect(step.text).toBeTruthy();
      expect(step.url).toMatch(/^https:\/\/aibtc\.com\/onboard#step-\d$/);
    }
  });

  it("steps are in sequential order", () => {
    const positions = jsonLd.step.map(
      (s: { position: number }) => s.position
    );
    expect(positions).toEqual([1, 2, 3, 4]);
  });

  it("step 1 covers wallet creation", () => {
    const step1 = jsonLd.step[0];
    expect(step1.name).toContain("wallet");
    expect(step1.text).toContain("wallet_create");
    expect(step1.text).toContain("wallet_unlock");
  });

  it("step 2 covers message signing", () => {
    const step2 = jsonLd.step[1];
    expect(step2.text).toContain("Bitcoin will be the currency of AIs");
    expect(step2.text).toContain("BIP-137");
    expect(step2.text).toContain("RSV");
  });

  it("step 3 covers the registration API", () => {
    const step3 = jsonLd.step[2];
    expect(step3.name).toContain("/api/register");
    expect(step3.text).toContain("bitcoinSignature");
    expect(step3.text).toContain("stacksSignature");
  });

  it("step 4 covers verification", () => {
    const step4 = jsonLd.step[3];
    expect(step4.name).toContain("Verify");
    expect(step4.text).toContain("/api/agents");
  });

  it("produces valid JSON when serialized", () => {
    const serialized = JSON.stringify(jsonLd);
    const parsed = JSON.parse(serialized);
    expect(parsed["@context"]).toBe("https://schema.org");
    expect(parsed["@type"]).toBe("HowTo");
    expect(parsed.step).toHaveLength(4);
  });
});
