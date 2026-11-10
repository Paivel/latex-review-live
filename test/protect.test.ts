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

  it("leaves edits that are not the user's alone", () => {
    expect(revertsOutsideBody(doc, [{ rangeOffset: 1, rangeLength: 0, text: "\\usepackage{x}\n" }], () => false)).toEqual([]);
  });

  it("leaves a file with no \\begin{document} alone", () => {
    expect(revertsOutsideBody("just text", [{ rangeOffset: 0, rangeLength: 0, text: "a" }])).toEqual([]);
  });
});

import { argumentStop, cutsHidden, mergeRanges, snapOffset } from "../src/preview/protect";

describe("hidden code", () => {
  const hidden = mergeRanges([[10, 15], [12, 19], [30, 31]]);
  it("joins overlapping ranges, keeps touching ones apart", () => {
    expect(hidden).toEqual([[10, 19], [30, 31]]);
    expect(mergeRanges([[0, 9], [9, 10]])).toEqual([[0, 9], [9, 10]]);
  });
  it("puts a click next to hidden braces inside them", () => {
    const t = "a \\caption{} b \\label{fig:x}";
    const cap = t.indexOf("\\caption");
    const open = t.indexOf("{") + 1;
    const lab = t.indexOf("\\label");
    const ranges = mergeRanges([[cap, open], [open, open + 1], [lab, t.indexOf("{", lab) + 1], [t.length - 1, t.length]]);
    expect(argumentStop(open + 1, ranges, t)).toBe(open); // after the hidden } of an empty caption
    expect(argumentStop(cap, ranges, t)).toBe(open); // before \caption{
    expect(argumentStop(t.length, ranges, t)).toBe(t.length - 1); // end of line, after \label{…}
    expect(argumentStop(1, ranges, t)).toBe(1);
  });
  it("moves a cursor out of hidden code the way it was going", () => {
    expect(snapOffset(12, 10, hidden)).toBe(19);
    expect(snapOffset(12, 19, hidden)).toBe(10);
    expect(snapOffset(10, 9, hidden)).toBe(10);
    expect(snapOffset(25, 24, hidden)).toBe(25);
  });
  it("refuses edits that cut into hidden code, allows whole removal and edits beside it", () => {
    expect(cutsHidden({ rangeOffset: 18, rangeLength: 1, text: "" }, hidden)).toBe(true); // backspace after it
    expect(cutsHidden({ rangeOffset: 12, rangeLength: 0, text: "x" }, hidden)).toBe(true);
    expect(cutsHidden({ rangeOffset: 19, rangeLength: 0, text: "x" }, hidden)).toBe(false);
    expect(cutsHidden({ rangeOffset: 5, rangeLength: 20, text: "" }, hidden)).toBe(false);
    expect(cutsHidden({ rangeOffset: 20, rangeLength: 3, text: "" }, hidden)).toBe(false);
  });
});
