import { describe, it, expect } from "vitest";
import { GET } from "../route";

describe("GET /llms-full.txt", () => {
  it("returns 200 with text/plain content-type", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
  });

  it("starts with H1 title following llmstxt.org convention", async () => {
    const response = await GET();
    const text = await response.text();

    expect(text.startsWith("# AIBTC")).toBe(true);
  });

  it("contains blockquote summary", async () => {
    const response = await GET();
    const text = await response.text();
    const lines = text.split("\n");

    const hasBlockquote = lines.some((line: string) => line.startsWith("> "));
    expect(hasBlockquote).toBe(true);
  });

  it("documents the registration API", async () => {
    const response = await GET();
    const text = await response.text();

    expect(text).toContain("POST /api/register");
    expect(text).toContain("bitcoinSignature");
    expect(text).toContain("stacksSignature");
    expect(text).toContain("Bitcoin will be the currency of AIs");
  });

  it("documents the agents API", async () => {
    const response = await GET();
    const text = await response.text();

    expect(text).toContain("GET /api/agents");
  });

  it("documents MCP setup instructions", async () => {
    const response = await GET();
    const text = await response.text();

    expect(text).toContain("npx @aibtc/mcp-server");
    expect(text).toContain("mcpServers");
  });

  it("documents available capabilities", async () => {
    const response = await GET();
    const text = await response.text();

    expect(text).toContain("Wallet Management");
    expect(text).toContain("DeFi Operations");
    expect(text).toContain("Smart Contracts");
    expect(text).toContain("Bitcoin Inscriptions");
  });

  it("sets cache headers", async () => {
    const response = await GET();
    const cacheControl = response.headers.get("cache-control");

    expect(cacheControl).toContain("public");
    expect(cacheControl).toContain("max-age=");
  });

  it("has substantial content (over 100 lines)", async () => {
    const response = await GET();
    const text = await response.text();
    const lineCount = text.split("\n").length;

    expect(lineCount).toBeGreaterThan(100);
  });
});
