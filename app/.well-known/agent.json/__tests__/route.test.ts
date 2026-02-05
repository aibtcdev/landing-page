import { describe, it, expect } from "vitest";
import { GET } from "../route";

describe("GET /.well-known/agent.json", () => {
  it("returns valid JSON with correct content-type", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("contains required Agent Card fields", async () => {
    const response = await GET();
    const data = await response.json();

    expect(data.name).toBe("AIBTC");
    expect(data.description).toBeTruthy();
    expect(data.url).toBe("https://aibtc.com");
    expect(data.version).toBeTruthy();
  });

  it("contains provider information", async () => {
    const response = await GET();
    const data = await response.json();

    expect(data.provider).toBeDefined();
    expect(data.provider.organization).toBeTruthy();
    expect(data.provider.url).toBeTruthy();
  });

  it("contains capabilities object", async () => {
    const response = await GET();
    const data = await response.json();

    expect(data.capabilities).toBeDefined();
    expect(typeof data.capabilities.streaming).toBe("boolean");
    expect(typeof data.capabilities.pushNotifications).toBe("boolean");
    expect(typeof data.capabilities.stateTransitionHistory).toBe("boolean");
  });

  it("contains at least one skill", async () => {
    const response = await GET();
    const data = await response.json();

    expect(Array.isArray(data.skills)).toBe(true);
    expect(data.skills.length).toBeGreaterThan(0);
  });

  it("each skill has required fields", async () => {
    const response = await GET();
    const data = await response.json();

    for (const skill of data.skills) {
      expect(skill.id).toBeTruthy();
      expect(skill.name).toBeTruthy();
      expect(skill.description).toBeTruthy();
      expect(Array.isArray(skill.tags)).toBe(true);
    }
  });

  it("includes agent-registration skill with sign message details", async () => {
    const response = await GET();
    const data = await response.json();

    const regSkill = data.skills.find(
      (s: { id: string }) => s.id === "agent-registration"
    );
    expect(regSkill).toBeDefined();
    expect(regSkill.description).toContain("/api/register");
    expect(regSkill.description).toContain(
      "Bitcoin will be the currency of AIs"
    );
  });

  it("includes agent-directory skill", async () => {
    const response = await GET();
    const data = await response.json();

    const dirSkill = data.skills.find(
      (s: { id: string }) => s.id === "agent-directory"
    );
    expect(dirSkill).toBeDefined();
    expect(dirSkill.description).toContain("/api/agents");
  });

  it("includes mcp-tools skill with install command", async () => {
    const response = await GET();
    const data = await response.json();

    const mcpSkill = data.skills.find(
      (s: { id: string }) => s.id === "mcp-tools"
    );
    expect(mcpSkill).toBeDefined();
    expect(mcpSkill.description).toContain("npx @aibtc/mcp-server");
  });

  it("sets cache headers", async () => {
    const response = await GET();
    const cacheControl = response.headers.get("cache-control");

    expect(cacheControl).toContain("public");
    expect(cacheControl).toContain("max-age=");
  });

  it("points documentationUrl to llms.txt", async () => {
    const response = await GET();
    const data = await response.json();

    expect(data.documentationUrl).toBe("https://aibtc.com/llms.txt");
  });
});
