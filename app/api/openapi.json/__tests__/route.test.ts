import { describe, it, expect } from "vitest";
import { GET } from "../route";

describe("GET /api/openapi.json", () => {
  it("returns 200 with application/json content-type", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("sets cache headers", async () => {
    const response = await GET();
    const cacheControl = response.headers.get("cache-control");

    expect(cacheControl).toContain("public");
    expect(cacheControl).toContain("max-age=3600");
    expect(cacheControl).toContain("s-maxage=86400");
  });

  it("returns valid OpenAPI 3.1.0 spec", async () => {
    const response = await GET();
    const spec = await response.json();

    expect(spec.openapi).toBe("3.1.0");
  });

  it("has info block with required fields", async () => {
    const response = await GET();
    const spec = await response.json();

    expect(spec.info).toBeDefined();
    expect(spec.info.title).toBe("AIBTC Agent API");
    expect(spec.info.description).toBeTruthy();
    expect(spec.info.version).toBeTruthy();
  });

  it("has production server URL", async () => {
    const response = await GET();
    const spec = await response.json();

    expect(Array.isArray(spec.servers)).toBe(true);
    expect(spec.servers.length).toBeGreaterThan(0);
    expect(spec.servers[0].url).toBe("https://aibtc.com");
  });

  // --- POST /api/register ---

  it("documents POST /api/register path", async () => {
    const response = await GET();
    const spec = await response.json();

    expect(spec.paths["/api/register"]).toBeDefined();
    expect(spec.paths["/api/register"].post).toBeDefined();
  });

  it("register endpoint has operationId", async () => {
    const response = await GET();
    const spec = await response.json();

    expect(spec.paths["/api/register"].post.operationId).toBe("registerAgent");
  });

  it("register endpoint documents the sign message", async () => {
    const response = await GET();
    const spec = await response.json();
    const description = spec.paths["/api/register"].post.description;

    expect(description).toContain("Bitcoin will be the currency of AIs");
  });

  it("register request body requires bitcoinSignature and stacksSignature", async () => {
    const response = await GET();
    const spec = await response.json();
    const requestSchema =
      spec.paths["/api/register"].post.requestBody.content[
        "application/json"
      ].schema;

    // Resolve $ref if used
    const schemaRef = requestSchema.$ref;
    let schema;
    if (schemaRef) {
      const refPath = schemaRef.replace("#/components/schemas/", "");
      schema = spec.components.schemas[refPath];
    } else {
      schema = requestSchema;
    }

    expect(schema.required).toContain("bitcoinSignature");
    expect(schema.required).toContain("stacksSignature");
    expect(schema.properties.bitcoinSignature).toBeDefined();
    expect(schema.properties.stacksSignature).toBeDefined();
  });

  it("register request body has optional description with maxLength 280", async () => {
    const response = await GET();
    const spec = await response.json();

    const schema = spec.components.schemas.RegisterRequest;
    expect(schema.properties.description).toBeDefined();
    expect(schema.properties.description.maxLength).toBe(280);
    // description should not be in required
    expect(schema.required).not.toContain("description");
  });

  it("register success response includes agent fields", async () => {
    const response = await GET();
    const spec = await response.json();

    const successSchema = spec.components.schemas.RegisterSuccess;
    expect(successSchema).toBeDefined();
    expect(successSchema.properties.success).toBeDefined();
    expect(successSchema.properties.agent).toBeDefined();

    const agentProps = successSchema.properties.agent.properties;
    expect(agentProps.stxAddress).toBeDefined();
    expect(agentProps.btcAddress).toBeDefined();
    expect(agentProps.displayName).toBeDefined();
    expect(agentProps.description).toBeDefined();
    expect(agentProps.bnsName).toBeDefined();
    expect(agentProps.verifiedAt).toBeDefined();
    expect(agentProps.verifiedAt.format).toBe("date-time");
  });

  it("register endpoint documents 400, 409, 500 error responses", async () => {
    const response = await GET();
    const spec = await response.json();
    const responses = spec.paths["/api/register"].post.responses;

    expect(responses["400"]).toBeDefined();
    expect(responses["409"]).toBeDefined();
    expect(responses["500"]).toBeDefined();
  });

  // --- GET /api/agents ---

  it("documents GET /api/agents path", async () => {
    const response = await GET();
    const spec = await response.json();

    expect(spec.paths["/api/agents"]).toBeDefined();
    expect(spec.paths["/api/agents"].get).toBeDefined();
  });

  it("agents endpoint has operationId", async () => {
    const response = await GET();
    const spec = await response.json();

    expect(spec.paths["/api/agents"].get.operationId).toBe("listAgents");
  });

  it("agents response contains agents array with correct record schema", async () => {
    const response = await GET();
    const spec = await response.json();

    const agentsSchema = spec.components.schemas.AgentsResponse;
    expect(agentsSchema).toBeDefined();
    expect(agentsSchema.properties.agents.type).toBe("array");

    // The array items should reference AgentRecord
    const agentRecord = spec.components.schemas.AgentRecord;
    expect(agentRecord).toBeDefined();

    // Verify required fields match actual API
    expect(agentRecord.required).toContain("stxAddress");
    expect(agentRecord.required).toContain("btcAddress");
    expect(agentRecord.required).toContain("stxPublicKey");
    expect(agentRecord.required).toContain("btcPublicKey");
    expect(agentRecord.required).toContain("verifiedAt");

    // Verify all properties are present
    expect(agentRecord.properties.stxAddress).toBeDefined();
    expect(agentRecord.properties.btcAddress).toBeDefined();
    expect(agentRecord.properties.stxPublicKey).toBeDefined();
    expect(agentRecord.properties.btcPublicKey).toBeDefined();
    expect(agentRecord.properties.displayName).toBeDefined();
    expect(agentRecord.properties.description).toBeDefined();
    expect(agentRecord.properties.bnsName).toBeDefined();
    expect(agentRecord.properties.verifiedAt).toBeDefined();
  });

  it("agents endpoint documents 500 error response", async () => {
    const response = await GET();
    const spec = await response.json();
    const responses = spec.paths["/api/agents"].get.responses;

    expect(responses["500"]).toBeDefined();
  });

  // --- Error schema ---

  it("ErrorResponse schema has required error field", async () => {
    const response = await GET();
    const spec = await response.json();

    const errorSchema = spec.components.schemas.ErrorResponse;
    expect(errorSchema).toBeDefined();
    expect(errorSchema.required).toContain("error");
    expect(errorSchema.properties.error.type).toBe("string");
  });

  // --- Cross-check: all responses reference valid schemas ---

  it("all $ref targets resolve to existing schemas", async () => {
    const response = await GET();
    const spec = await response.json();

    const refs: string[] = [];

    // Collect all $ref values from the spec
    function collectRefs(obj: unknown) {
      if (obj && typeof obj === "object") {
        const record = obj as Record<string, unknown>;
        if ("$ref" in record && typeof record.$ref === "string") {
          refs.push(record.$ref);
        }
        for (const value of Object.values(record)) {
          collectRefs(value);
        }
      }
    }

    collectRefs(spec.paths);

    for (const ref of refs) {
      const schemaName = ref.replace("#/components/schemas/", "");
      expect(
        spec.components.schemas[schemaName],
        `$ref target ${ref} should resolve to an existing schema`
      ).toBeDefined();
    }
  });
});
