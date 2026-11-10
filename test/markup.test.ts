import { describe, expect, it } from "vitest";
import { computeChanges } from "../src/review/diff";
import { markUp, mathMap } from "../src/review/markup";

const doc = (body: string) => `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`;

describe("markUp", () => {
  it("wraps changes with the changes package and adds it", () => {
    const base = doc("The cat sat on the mat.");
    const cur = doc("The black cat sat on a rug.");
    const out = markUp(cur, computeChanges(base, cur), []);
    expect(out.text).toContain("\\usepackage[markup=default]{changes}");
    expect(out.text).toContain("\\added{black }");
    expect(out.text).toContain("\\replaced{a rug}{the mat}");
    expect(out.plain).toBe(0);
  });

  it("leaves math changes unmarked", () => {
    const base = doc("Energy $E = mc^2$ here.");
    const cur = doc("Energy $E = mc^3$ here.");
    const out = markUp(cur, computeChanges(base, cur), []);
    expect(out.plain).toBe(1);
    expect(out.text).not.toContain("\\replaced");
  });

  it("puts comments after the commented text, escaped", () => {
    const cur = doc("Yield was 95%.");
    const start = cur.indexOf("95");
    const out = markUp(cur, [], [{ id: "t", start, end: start + 3, quote: "95%", resolved: false, comments: [{ id: "c", author: "Pavel", body: "Check 100% & recalc", created: "" }] }]);
    expect(out.text).toContain("95%\\comment{Pavel: Check 100\\% \\& recalc}");
  });
});

describe("mathMap", () => {
  it("knows inline, display and environment math", () => {
    const t = "a $x$ b \\[y\\] c \\begin{align}z\\end{align} d \\$ e";
    const m = mathMap(t);
    expect(m(t.indexOf("x"))).toBe(true);
    expect(m(t.indexOf("y"))).toBe(true);
    expect(m(t.indexOf("z"))).toBe(true);
    expect(m(t.indexOf("b"))).toBe(false);
    expect(m(t.indexOf("e", t.indexOf("\\$")))).toBe(false);
  });
});
