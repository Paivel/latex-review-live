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
    "\\begin{document}", //        2 code (hidden)
    "\\section{Intro}", //         3 text
    "\\label{sec:intro}", //       4 code
    "% a note", //                 5 code
    "", //                         6 blank
    "Some \\textbf{text}.", //     7 text
    "\\begin{itemize}", //         8 code
    "\\item one", //               9 text
    "\\end{itemize}", //          10 code
    "\\centering", //             11 code
    "", //                        12 blank
    "More.", //                   13 text
    "\\end{document}", //         14 code
  ].join("\n");

  it("tells text, code and blank lines apart", () => {
    expect(kinds(src)).toEqual(["code", "code", "code", "text", "code", "code", "blank", "text", "code", "text", "code", "code", "blank", "text", "code"]);
  });

  it("folds each run from the line above it, blank lines inside a run included", () => {
    expect(codeRuns(kinds(src), new Set())).toEqual([
      [0, 2],
      [3, 5],
      [7, 8],
      [9, 11],
      [13, 14],
    ]);
  });

  it("keeps the run under the cursor open", () => {
    expect(codeRuns(kinds(src), new Set([4]))).toEqual([
      [0, 2],
      [7, 8],
      [9, 11],
      [13, 14],
    ]);
  });

  it("a line with a figure marker or reference is text", () => {
    expect(kinds("\\begin{document}\n\\begin{figure}[h]\n\\caption{x}\n\\ref{a}")).toEqual(["code", "text", "text", "text"]);
  });
});
