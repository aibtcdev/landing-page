import { describe, it, expect } from "vitest";
import { shouldFailClosed } from "../env";

describe("shouldFailClosed", () => {
  it("returns true when DEPLOY_ENV is set (production)", () => {
    expect(shouldFailClosed({ DEPLOY_ENV: "production" } as unknown as CloudflareEnv)).toBe(true);
  });

  it("returns false when DEPLOY_ENV is undefined (local dev)", () => {
    expect(shouldFailClosed({} as unknown as CloudflareEnv)).toBe(false);
  });
});
