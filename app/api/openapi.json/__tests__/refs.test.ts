import { describe, it, expect } from "vitest";
import { GET } from "../route";

describe("GET /api/openapi.json", () => {
  it("defines every schema it references under components.schemas", async () => {
    const spec = await GET().json();
    const refs = new Set(
      [...JSON.stringify(spec).matchAll(/#\/components\/schemas\/([A-Za-z0-9_]+)/g)].map((m) => m[1])
    );
    const missing = [...refs].filter((name) => !(name in spec.components.schemas));
    expect(missing).toEqual([]);
  });
});
