import { describe, expect, it } from "vitest";
import { codeRuns, lineKinds } from "../src/preview/fold";
import { parseLatex } from "../src/preview/parse";

const kinds = (src: string) => {
  const b = src.indexOf("\\begin{document}");
  return lineKinds(src, parseLatex(src), b < 0 ? 0 : b);
};

describe("code-only lines", () => {
  const src = [
    "\\documentclass{article}", // 0 code (preamble)
    "\\usepackage{x}", //          1 code
    "\\begin{document}", //        2 text (shown)
    "\\section{Intro}", //         3 text
    "\\label{sec:intro}", //       4 text (its key shows)
    "% a note", //                 5 code
    "", //                         6 blank
    "Some \\textbf{text}.", //     7 text
    "\\begin{itemize}", //         8 text
    "\\item one", //               9 text
    "\\end{itemize}", //          10 text
    "\\centering", //             11 code
    "", //                        12 blank
    "More.", //                   13 text
    "\\end{document}", //         14 text
  ].join("\n");

  it("tells text, code and blank lines apart", () => {
    expect(kinds(src)).toEqual(["code", "code", "text", "text", "text", "code", "blank", "text", "text", "text", "text", "code", "blank", "text", "text"]);
  });

  it("folds each run from the line above it, blank lines inside a run included", () => {
    expect(codeRuns(kinds(src), new Set())).toEqual([
      [0, 1],
      [4, 5],
      [10, 11],
    ]);
  });

  it("keeps the cursor's line open and folds the rest of its run", () => {
    expect(codeRuns(kinds(src), new Set([5]))).toEqual([
      [0, 1],
      [10, 11],
    ]);
    // Cursor in the middle of the preamble: above it and below it fold.
    const pre = ["\\documentclass{article}", "\\a", "\\b", "\\c", "\\d", "\\begin{document}", "Text"].join("\n");
    expect(codeRuns(kinds(pre), new Set([3]))).toEqual([
      [0, 2],
      [3, 4],
    ]);
  });

  it("a line with a figure marker or reference is text", () => {
    expect(kinds("\\begin{document}\n\\begin{figure}[h]\n\\caption{x}\n\\ref{a}")).toEqual(["text", "text", "text", "text"]);
  });
});
