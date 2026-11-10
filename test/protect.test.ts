import { describe, expect, it } from "vitest";
import { bodyBounds, revertsOutsideBody } from "../src/preview/protect";

const doc = "\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n";
const apply = (t: string, rs: { start: number; end: number; text: string }[]) =>
  [...rs].sort((a, b) => b.start - a.start).reduce((s, r) => s.slice(0, r.start) + r.text + s.slice(r.end), t);
const edit = (t: string, at: number, len: number, text: string) => t.slice(0, at) + text + t.slice(at + len);

describe("protected preamble", () => {
  it("finds the body", () => {
    const [a, b] = bodyBounds(doc)!;
    expect(doc.slice(a, b)).toBe("Hello.\n");
  });

  it("allows edits in the body", () => {
    const at = doc.indexOf("Hello");
    expect(revertsOutsideBody(doc, [{ rangeOffset: at, rangeLength: 5, text: "Hi" }])).toEqual([]);
    expect(revertsOutsideBody(doc, [{ rangeOffset: doc.indexOf("\\end"), rangeLength: 0, text: "x" }])).toEqual([]);
  });

  it("puts back edits in the preamble and after the end, keeping body edits", () => {
    const changes = [
      { rangeOffset: 1, rangeLength: 0, text: "XX" },
      { rangeOffset: doc.indexOf("Hello"), rangeLength: 5, text: "Hi" },
      { rangeOffset: doc.length - 1, rangeLength: 1, text: "" },
    ];
    let now = doc;
    for (const c of [...changes].sort((a, b) => b.rangeOffset - a.rangeOffset)) now = edit(now, c.rangeOffset, c.rangeLength, c.text);
    expect(apply(now, revertsOutsideBody(doc, changes))).toBe(doc.replace("Hello", "Hi"));
  });

  it("leaves a file with no \\begin{document} alone", () => {
    expect(revertsOutsideBody("just text", [{ rangeOffset: 0, rangeLength: 0, text: "a" }])).toEqual([]);
  });
});
