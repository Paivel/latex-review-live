import { describe, expect, it } from "vitest";
import { acceptInBase, changeAt, changesBetween, computeChanges, editSegs, kindOf, rejectInCurrent, segsOf, segsValid } from "../src/review/diff";

describe("computeChanges", () => {
  it("finds an inserted word", () => {
    const cs = computeChanges("The cat sat.", "The black cat sat.");
    expect(cs).toHaveLength(1);
    expect(kindOf(cs[0])).toBe("insert");
    expect(cs[0].inserted).toBe("black ");
  });

  it("finds a deleted word", () => {
    const cs = computeChanges("The black cat sat.", "The cat sat.");
    expect(cs).toHaveLength(1);
    expect(kindOf(cs[0])).toBe("delete");
    expect(cs[0].deleted).toBe("black ");
  });

  it("merges a rewritten phrase into one replacement", () => {
    const cs = computeChanges("a big red dog ran", "a small blue cat ran");
    expect(cs).toHaveLength(1);
    expect(cs[0].deleted).toBe("big red dog");
    expect(cs[0].inserted).toBe("small blue cat");
  });

  it("keeps separate edits separate", () => {
    const base = "First sentence here.\n\nSecond one there.";
    const cur = "First clause here.\n\nSecond one everywhere.";
    const cs = computeChanges(base, cur);
    expect(cs.map((c) => [c.deleted, c.inserted])).toEqual([
      ["sentence", "clause"],
      ["there", "everywhere"],
    ]);
  });

  it("round-trips: rejecting all gives the baseline, accepting all gives the current text", () => {
    const base = "We heated \\ce{H2O} to 100 C for 2 h, then cooled it.";
    const cur = "We heated water to \\SI{100}{\\celsius} for 3 h and cooled it slowly.";
    const cs = computeChanges(base, cur);
    expect(rejectInCurrent(cur, cs)).toBe(base);
    let b = base;
    for (const c of [...cs].sort((x, y) => y.baseStart - x.baseStart)) b = acceptInBase(b, c);
    expect(b).toBe(cur);
  });

  it("accepting one change leaves the others", () => {
    const base = "one two three";
    const cur = "one 2 three 4";
    const cs = computeChanges(base, cur);
    expect(cs).toHaveLength(2);
    const after = computeChanges(acceptInBase(base, cs[0]), cur);
    expect(after).toHaveLength(1);
    expect(after[0].inserted).toBe(" 4");
  });

  it("finds the change at an offset, including the empty spot of a deletion", () => {
    const cur = "The cat sat.";
    const cs = computeChanges("The black cat sat.", cur);
    expect(changeAt(cs, 4)).toBe(cs[0]);
    expect(changeAt(cs, 10)).toBeUndefined();
  });

  it("does not split a word at the common prefix", () => {
    const cs = computeChanges("reaction", "reactions");
    expect(cs).toHaveLength(1);
    expect(cs[0].deleted).toBe("reaction");
    expect(cs[0].inserted).toBe("reactions");
  });
});

describe("changesBetween (incremental)", () => {
  const base = "Intro\n\nsas\n\nsaasasas\n";
  const cur1 = "Intro\nalpha\nbeta\ngamma\n\nmm nnn\n\ndfdfdf\n\n\n\nsas\n\nsaasasas\n";
  const at = cur1.indexOf("sas\n\nsaa");
  const cur2 = cur1.slice(0, at) + cur1.slice(at + 3);

  it("keeps a deletion where the text was, next to earlier insertions", () => {
    const segs = editSegs(segsOf(base, cur1, computeChanges(base, cur1)), "c", at, at + 3, 0);
    expect(segsValid(base, cur2, segs)).toBe(true);
    const cs = changesBetween(base, cur2, segs);
    const del = cs.find((c) => c.deleted.includes("sas"))!;
    expect(del.curStart).toBeGreaterThan(cur2.indexOf("dfdfdf"));
    expect(rejectInCurrent(cur2, cs)).toBe(base);
  });

  it("gives back whole words when an edit lands mid-word", () => {
    const b = "The quick fox.";
    const c = "The quixck fox.";
    const segs = editSegs(segsOf(b, b, []), "c", 7, 7, 1);
    const cs = changesBetween(b, c, segs);
    expect(cs.map((x) => [x.deleted, x.inserted])).toEqual([["quick", "quixck"]]);
  });

  it("an insertion between words stays a pure insertion", () => {
    const b = "foo bar";
    const c = "foo new bar";
    const cs = changesBetween(b, c, editSegs(segsOf(b, b, []), "c", 4, 4, 4));
    expect(cs.map((x) => [x.deleted, x.inserted])).toEqual([["", "new "]]);
  });

  it("undoing a deletion leaves no change", () => {
    const b = "one two three";
    const c = "one three";
    let segs = segsOf(b, c, computeChanges(b, c));
    segs = editSegs(segs, "c", 4, 4, 4);
    expect(changesBetween(b, b, segs)).toEqual([]);
  });
});

describe("whole lines stay whole", () => {
  it("shows a moved-away float as one deletion, not matched word by word with the text around it", () => {
    const base = "Files are free.\n\n\\end{suppinfo}\n\\begin{scheme}\n  \\centering\n  \\input{figures/a}\n  \\caption{}\n\\end{scheme}\n%% end\n";
    const cur = "Files are free.\nnew line\nother \\rcmpd{1}\n\n\\end{suppinfo}\n%% end\n";
    const ch = computeChanges(base, cur);
    expect(ch.some((c) => c.deleted.includes("\\begin{scheme}") && c.deleted.includes("\\end{scheme}") && c.inserted === "")).toBe(true);
    expect(ch.every((c) => !c.deleted.includes("suppinfo"))).toBe(true);
  });
});
