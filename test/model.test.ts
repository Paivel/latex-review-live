import { describe, expect, it } from "vitest";
import { parseReview, reanchor, serializeReview, shiftRange } from "../src/review/model";

describe("shiftRange", () => {
  it("moves a range after an edit before it", () => {
    expect(shiftRange(10, 15, 0, 0, 3)).toEqual([13, 18]);
    expect(shiftRange(10, 15, 2, 5, 0)).toEqual([7, 12]);
  });
  it("leaves a range before the edit", () => {
    expect(shiftRange(1, 4, 6, 8, 10)).toEqual([1, 4]);
  });
  it("grows with an edit inside it", () => {
    expect(shiftRange(10, 20, 12, 14, 6)).toEqual([10, 24]);
  });
  it("does not grow with typing at its end", () => {
    expect(shiftRange(10, 20, 20, 20, 5)).toEqual([10, 20]);
  });
  it("collapses when its text is deleted", () => {
    expect(shiftRange(10, 20, 5, 25, 0)).toEqual([5, 5]);
  });
});

describe("reanchor", () => {
  it("finds moved text by its quote", () => {
    expect(reanchor("xx hello world", 0, 5, "hello")).toEqual([3, 8]);
  });
  it("takes the nearest of several", () => {
    expect(reanchor("ab ab ab ab", 7, 9, "ab")).toEqual([6, 8]);
  });
  it("clamps when the quote is gone", () => {
    expect(reanchor("short", 3, 40, "missing")).toEqual([3, 5]);
  });
});

describe("review file", () => {
  it("round-trips", () => {
    const r = parseReview(
      JSON.stringify({ version: 1, baseline: "x", threads: [{ id: "a", start: 0, end: 1, quote: "x", resolved: false, comments: [{ id: "c", author: "P", body: "hi", created: "2026" }] }] }),
    );
    expect(parseReview(serializeReview(r))).toEqual(r);
  });
  it("drops broken threads", () => {
    expect(parseReview(JSON.stringify({ threads: [{ start: "x" }, null] })).threads).toEqual([]);
  });
});
