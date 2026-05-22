import { describe, it, expect } from "vitest";
import { stripMarkdown } from "../utils";

describe("stripMarkdown", () => {
  it("strips ATX headings", () => {
    expect(stripMarkdown("## Goal\nDo the thing")).toBe("Goal Do the thing");
    expect(stripMarkdown("# H1 only")).toBe("H1 only");
    expect(stripMarkdown("###### H6")).toBe("H6");
  });

  it("strips bold and italic markers", () => {
    expect(stripMarkdown("**bold** and *italic*")).toBe("bold and italic");
    expect(stripMarkdown("__bold2__ and _italic2_")).toBe("bold2 and italic2");
  });

  it("strips strikethrough", () => {
    expect(stripMarkdown("~~gone~~")).toBe("gone");
  });

  it("strips fenced code blocks but keeps surrounding prose", () => {
    expect(stripMarkdown("Before\n```js\nconst x = 1;\n```\nAfter")).toBe("Before After");
  });

  it("strips inline code backticks but keeps content", () => {
    expect(stripMarkdown("Use `npm install` first")).toBe("Use npm install first");
  });

  it("strips list markers", () => {
    expect(stripMarkdown("- one\n- two\n- three")).toBe("one two three");
    expect(stripMarkdown("1. first\n2. second")).toBe("first second");
  });

  it("strips blockquote markers", () => {
    expect(stripMarkdown("> quoted line\n> another")).toBe("quoted line another");
  });

  it("flattens link text and drops the url", () => {
    expect(stripMarkdown("See [the docs](https://aibtc.com/docs) here")).toBe(
      "See the docs here"
    );
  });

  it("flattens image alt and drops the src", () => {
    expect(stripMarkdown("![alt text](https://x.png) before")).toBe("alt text before");
  });

  it("collapses whitespace", () => {
    expect(stripMarkdown("a\n\n\nb   c")).toBe("a b c");
  });

  it("handles a real bounty description with mixed syntax", () => {
    const input =
      "## Goal\nImport external **attention** to the [bounty board](https://aibtc.com/bounty). Most agent-econ traffic still routes elsewhere.\n\n- Test 1\n- Test 2";
    expect(stripMarkdown(input)).toBe(
      "Goal Import external attention to the bounty board. Most agent-econ traffic still routes elsewhere. Test 1 Test 2"
    );
  });

  it("is a no-op on plain text", () => {
    expect(stripMarkdown("Just some plain text.")).toBe("Just some plain text.");
  });
});
