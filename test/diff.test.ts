import { describe, expect, it } from "vitest";
import { acceptInBase, changeAt, computeChanges, kindOf, rejectInCurrent } from "../src/review/diff";

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
