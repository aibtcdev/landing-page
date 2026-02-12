import { describe, it, expect } from "vitest";
import {
  buildSignedMessage,
  SIGNED_MESSAGE_FORMAT,
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

describe("constant values", () => {
  it("MAX_RESPONSE_LENGTH is 500 characters", () => {
    expect(MAX_RESPONSE_LENGTH).toBe(500);
  });

  it("SIGNED_MESSAGE_FORMAT contains required placeholders", () => {
    expect(SIGNED_MESSAGE_FORMAT).toContain("{messageId}");
    expect(SIGNED_MESSAGE_FORMAT).toContain("{response}");
  });
});
