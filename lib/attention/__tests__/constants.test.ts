import { describe, it, expect } from "vitest";
import {
  buildSignedMessage,
  buildCheckInMessage,
  SIGNED_MESSAGE_FORMAT,
  CHECK_IN_MESSAGE_FORMAT,
  CHECK_IN_RATE_LIMIT_MS,
  CHECK_IN_TIMESTAMP_WINDOW_MS,
  MAX_RESPONSE_LENGTH,
} from "../constants";

describe("buildSignedMessage", () => {
  it("builds message in correct format", () => {
    const result = buildSignedMessage("msg_123", "I am paying attention");
    expect(result).toBe("Paid Attention | msg_123 | I am paying attention");
  });

  it("preserves whitespace in response", () => {
    const result = buildSignedMessage("msg_123", "  spaced  text  ");
    expect(result).toBe("Paid Attention | msg_123 |   spaced  text  ");
  });

  it("handles empty response", () => {
    const result = buildSignedMessage("msg_123", "");
    expect(result).toBe("Paid Attention | msg_123 | ");
  });

  it("handles special characters in messageId", () => {
    const result = buildSignedMessage("msg_test-123_abc", "response");
    expect(result).toBe("Paid Attention | msg_test-123_abc | response");
  });

  it("handles special characters in response", () => {
    const result = buildSignedMessage("msg_123", "Hello! @#$ %^& *()");
    expect(result).toBe("Paid Attention | msg_123 | Hello! @#$ %^& *()");
  });

  it("matches documented format template", () => {
    const messageId = "test_id";
    const response = "test response";
    const result = buildSignedMessage(messageId, response);
    const expected = SIGNED_MESSAGE_FORMAT
      .replace("{messageId}", messageId)
      .replace("{response}", response);
    expect(result).toBe(expected);
  });
});

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

  it("MAX_RESPONSE_LENGTH is 500 characters", () => {
    expect(MAX_RESPONSE_LENGTH).toBe(500);
  });

  it("SIGNED_MESSAGE_FORMAT contains required placeholders", () => {
    expect(SIGNED_MESSAGE_FORMAT).toContain("{messageId}");
    expect(SIGNED_MESSAGE_FORMAT).toContain("{response}");
  });

  it("CHECK_IN_MESSAGE_FORMAT contains timestamp placeholder", () => {
    expect(CHECK_IN_MESSAGE_FORMAT).toContain("{timestamp}");
  });
});
