import { describe, expect, it } from "vitest";
import { toggleWrap } from "../src/format/wrap";

const apply = (t: string, w: ReturnType<typeof toggleWrap>) => t.slice(0, w.start) + w.text + t.slice(w.end);

describe("toggleWrap", () => {
  it("wraps a selection", () => {
    const t = "a word here";
    const w = toggleWrap(t, "textbf", 2, 6);
    expect(apply(t, w)).toBe("a \\textbf{word} here");
    expect(apply(t, w).slice(w.selStart, w.selEnd)).toBe("word");
  });
  it("unwraps when the inner text is selected", () => {
    const t = "a \\textbf{word} here";
    const w = toggleWrap(t, "textbf", 10, 14);
    expect(apply(t, w)).toBe("a word here");
    expect(apply(t, w).slice(w.selStart, w.selEnd)).toBe("word");
  });
  it("unwraps when the whole group is selected", () => {
    const t = "a \\textit{word} here";
    expect(apply(t, toggleWrap(t, "textit", 2, 15))).toBe("a word here");
  });
  it("unwraps around the caret", () => {
    const t = "a \\underline{some {x} words} b";
    expect(apply(t, toggleWrap(t, "underline", 16, 16))).toBe("a some {x} words b");
  });
  it("inserts an empty group at a caret outside one", () => {
    const t = "ab";
    const w = toggleWrap(t, "textbf", 1, 1);
    expect(apply(t, w)).toBe("a\\textbf{}b");
    expect(w.selStart).toBe(9);
  });
  it("wraps bold inside italic", () => {
    const t = "\\textit{one two}";
    expect(apply(t, toggleWrap(t, "textbf", 8, 11))).toBe("\\textit{\\textbf{one} two}");
  });
});
