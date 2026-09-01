import { describe, it, expect } from "vitest";
import { truncateAtWord, formatSatsFull } from "../utils";

describe("truncateAtWord", () => {
  it("leaves text that already fits, and reports no truncation", () => {
    expect(truncateAtWord("short enough", 50)).toEqual({
      text: "short enough",
      truncated: false,
    });
  });

  it("cuts on a word boundary, never mid-word", () => {
    const { text, truncated } = truncateAtWord("alpha beta gamma delta", 14);
    expect(truncated).toBe(true);
    expect(text).toBe("alpha beta");
    expect(text.length).toBeLessThanOrEqual(14);
  });

  it("drops a trailing separator so the ellipsis does not read as ',…'", () => {
    const { text } = truncateAtWord("audit the router, then report back", 18);
    expect(text.endsWith(",")).toBe(false);
    expect(text).toBe("audit the router");
  });

  it("hard-cuts a single token with no space to break on", () => {
    const long = "a".repeat(80);
    const { text, truncated } = truncateAtWord(long, 20);
    expect(truncated).toBe(true);
    expect(text).toHaveLength(20);
  });

  it("is exact at the boundary", () => {
    expect(truncateAtWord("abcde", 5).truncated).toBe(false);
    expect(truncateAtWord("abcdef", 5).truncated).toBe(true);
  });
});

describe("formatSatsFull", () => {
  it("groups every digit rather than abbreviating", () => {
    expect(formatSatsFull(21000)).toBe("21,000");
    expect(formatSatsFull(146100)).toBe("146,100");
    expect(formatSatsFull(500)).toBe("500");
  });
});
