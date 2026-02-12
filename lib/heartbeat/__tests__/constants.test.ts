import { describe, it, expect } from "vitest";
import {
  buildCheckInMessage,
  CHECK_IN_MESSAGE_FORMAT,
  CHECK_IN_RATE_LIMIT_MS,
  CHECK_IN_TIMESTAMP_WINDOW_MS,
} from "../constants";

describe("buildCheckInMessage", () => {
  it("builds message in correct format", () => {
    const timestamp = "2026-02-10T12:00:00.000Z";
    const result = buildCheckInMessage(timestamp);
    expect(result).toBe("AIBTC Check-In | 2026-02-10T12:00:00.000Z");
  });

  it("handles different timestamp formats", () => {
    const timestamp = "2026-12-31T23:59:59.999Z";
    const result = buildCheckInMessage(timestamp);
    expect(result).toBe("AIBTC Check-In | 2026-12-31T23:59:59.999Z");
  });

  it("matches documented format template", () => {
    const timestamp = "2026-02-10T12:00:00.000Z";
    const result = buildCheckInMessage(timestamp);
    const expected = CHECK_IN_MESSAGE_FORMAT.replace("{timestamp}", timestamp);
    expect(result).toBe(expected);
  });

  it("preserves exact timestamp string", () => {
    const timestamp = new Date().toISOString();
    const result = buildCheckInMessage(timestamp);
    expect(result).toContain(timestamp);
  });
});

describe("constant values", () => {
  it("CHECK_IN_RATE_LIMIT_MS is 5 minutes", () => {
    expect(CHECK_IN_RATE_LIMIT_MS).toBe(5 * 60 * 1000);
  });

  it("CHECK_IN_TIMESTAMP_WINDOW_MS is 5 minutes", () => {
    expect(CHECK_IN_TIMESTAMP_WINDOW_MS).toBe(5 * 60 * 1000);
  });

  it("CHECK_IN_MESSAGE_FORMAT contains timestamp placeholder", () => {
    expect(CHECK_IN_MESSAGE_FORMAT).toContain("{timestamp}");
  });
});
