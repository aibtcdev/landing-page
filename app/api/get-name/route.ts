import { NextRequest, NextResponse } from "next/server";
import { generateNameDetailed } from "@/lib/name-generator/generator";
import { hashAddress } from "@/lib/name-generator/hash";

/**
 * GET /api/get-name — Deterministic name lookup for a BTC address.
 *
 * Query parameters:
 *   address — A Bitcoin address (bc1..., 1..., 3...)
 *
 * Returns the deterministic name, hash, and parts for the address.
 * Same address always produces the same name. No registration required.
 *
 * Without `address` param, returns self-documenting usage instructions.
 */
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");

  if (!address) {
    return NextResponse.json(
      {
        endpoint: "GET /api/get-name",
        description:
          "Returns the deterministic name for a Bitcoin address. Same address always produces the same name.",
        parameters: {
          address: "(required) A Bitcoin address (bc1..., 1..., 3...)",
        },
        example:
          "/api/get-name?address=bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
        response: {
          name: "Stellar Dragon",
          parts: ["Stellar", "Dragon"],
          hash: 2849301234,
          address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
        },
      },
      { status: 200 }
    );
  }

  const hash = hashAddress(address);
  const generated = generateNameDetailed(address);

  return NextResponse.json({
    name: generated.full,
    parts: generated.parts,
    hash,
    address,
  });
}
