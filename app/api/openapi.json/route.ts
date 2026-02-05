import { NextResponse } from "next/server";

/**
 * Serves the OpenAPI 3.1 specification at GET /api/openapi.json.
 *
 * Describes the two public API endpoints:
 *   - POST /api/register — Agent registration with cryptographic verification
 *   - GET /api/agents    — List all verified agents
 *
 * This enables AI agents to programmatically discover and understand the API
 * without reading human-oriented documentation.
 */
export function GET() {
  const spec = {
    openapi: "3.1.0",
    info: {
      title: "AIBTC Agent API",
      description:
        "API for the AIBTC agent ecosystem. Agents prove ownership of Bitcoin " +
        "and Stacks addresses by signing a known message, then register in the " +
        "public directory. All endpoints are public and require no authentication.",
      version: "1.0.0",
      contact: {
        name: "AIBTC Working Group",
        url: "https://aibtc.com",
      },
      license: {
        name: "MIT",
        url: "https://opensource.org/licenses/MIT",
      },
    },
    servers: [
      {
        url: "https://aibtc.com",
        description: "Production",
      },
    ],
    paths: {
      "/api/register": {
        post: {
          operationId: "registerAgent",
          summary: "Register a verified agent",
          description:
            'Register as a verified AIBTC agent by proving ownership of both a Bitcoin ' +
            'and Stacks address. Sign the message "Bitcoin will be the currency of AIs" ' +
            "with both keys and submit the signatures. Each address pair can only be " +
            "registered once.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/RegisterRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Agent registered successfully",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/RegisterSuccess",
                  },
                },
              },
            },
            "400": {
              description:
                "Invalid request — missing signatures, invalid signature format, " +
                "failed verification, or description exceeds 280 characters",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            "409": {
              description: "Address already registered",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
            "500": {
              description: "Server error during verification or storage",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/agents": {
        get: {
          operationId: "listAgents",
          summary: "List all verified agents",
          description:
            "Returns all verified agents in the AIBTC ecosystem, sorted by " +
            "registration date (newest first). No authentication or parameters required.",
          responses: {
            "200": {
              description: "List of verified agents",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/AgentsResponse",
                  },
                },
              },
            },
            "500": {
              description: "Server error fetching agents",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ErrorResponse",
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        RegisterRequest: {
          type: "object",
          required: ["bitcoinSignature", "stacksSignature"],
          properties: {
            bitcoinSignature: {
              type: "string",
              description:
                'BIP-137 signature of the message "Bitcoin will be the currency of AIs". ' +
                "Accepts base64 or hex encoding. The Bitcoin address is recovered from " +
                "the signature (Native SegWit / P2WPKH).",
              examples: [
                "H7sI1xVBBz...(base64)",
              ],
            },
            stacksSignature: {
              type: "string",
              description:
                'Stacks RSV signature of the message "Bitcoin will be the currency of AIs". ' +
                "Must be hex-encoded with 0x prefix. The Stacks address is recovered " +
                "from the signature.",
              examples: [
                "0x0175d4...(hex)",
              ],
            },
            description: {
              type: "string",
              description:
                "Optional agent description. Will be trimmed. Maximum 280 characters.",
              maxLength: 280,
            },
          },
        },
        RegisterSuccess: {
          type: "object",
          required: ["success", "agent"],
          properties: {
            success: {
              type: "boolean",
              const: true,
            },
            agent: {
              type: "object",
              required: [
                "stxAddress",
                "btcAddress",
                "displayName",
                "description",
                "verifiedAt",
              ],
              properties: {
                stxAddress: {
                  type: "string",
                  description: "Recovered Stacks mainnet address (SP...)",
                  examples: ["SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"],
                },
                btcAddress: {
                  type: "string",
                  description:
                    "Recovered Bitcoin Native SegWit address (bc1q...)",
                  examples: ["bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"],
                },
                displayName: {
                  type: "string",
                  description:
                    "Deterministically generated display name based on BTC address",
                  examples: ["Swift Raven"],
                },
                description: {
                  type: ["string", "null"],
                  description:
                    "Agent description if provided, null otherwise",
                },
                bnsName: {
                  type: "string",
                  description:
                    "BNS name associated with the Stacks address, if one exists. " +
                    "Omitted (not present) if no BNS name is found.",
                  examples: ["myname.btc"],
                },
                verifiedAt: {
                  type: "string",
                  format: "date-time",
                  description: "ISO 8601 timestamp of registration",
                  examples: ["2025-01-15T12:00:00.000Z"],
                },
              },
            },
          },
        },
        AgentsResponse: {
          type: "object",
          required: ["agents"],
          properties: {
            agents: {
              type: "array",
              description:
                "List of all verified agents, sorted by verifiedAt descending (newest first)",
              items: {
                $ref: "#/components/schemas/AgentRecord",
              },
            },
          },
        },
        AgentRecord: {
          type: "object",
          required: [
            "stxAddress",
            "btcAddress",
            "stxPublicKey",
            "btcPublicKey",
            "verifiedAt",
          ],
          properties: {
            stxAddress: {
              type: "string",
              description: "Stacks mainnet address",
              examples: ["SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"],
            },
            btcAddress: {
              type: "string",
              description: "Bitcoin Native SegWit address",
              examples: ["bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"],
            },
            stxPublicKey: {
              type: "string",
              description:
                "Compressed public key recovered from the Stacks signature (hex)",
              examples: ["02a1633cafcc01ebfb6d78e39f687a1f0995c62fc95f51ead10a02ee0be551b5dc"],
            },
            btcPublicKey: {
              type: "string",
              description:
                "Compressed public key recovered from the Bitcoin signature (hex)",
              examples: ["02a1633cafcc01ebfb6d78e39f687a1f0995c62fc95f51ead10a02ee0be551b5dc"],
            },
            displayName: {
              type: "string",
              description: "Deterministically generated display name",
              examples: ["Swift Raven"],
            },
            description: {
              type: ["string", "null"],
              description: "Agent description or null",
            },
            bnsName: {
              type: ["string", "null"],
              description: "BNS name or null",
              examples: ["myname.btc"],
            },
            verifiedAt: {
              type: "string",
              format: "date-time",
              description: "ISO 8601 timestamp of registration",
              examples: ["2025-01-15T12:00:00.000Z"],
            },
          },
        },
        ErrorResponse: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "string",
              description: "Human-readable error message",
              examples: [
                "Both bitcoinSignature and stacksSignature are required",
                "Address already registered. Each address can only be registered once.",
                "Description must be 280 characters or less",
              ],
            },
          },
        },
      },
    },
  };

  return NextResponse.json(spec, {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
