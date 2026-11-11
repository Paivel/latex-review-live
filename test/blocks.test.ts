import { describe, expect, it } from "vitest";
import { commandOnly, headingNumbers, splitBlocks } from "../src/visual/blocks";

const doc = String.raw`\documentclass{article}
\usepackage{graphicx}
\begin{document}
\maketitle
\section{Introduction}
First paragraph line one
continues here with $x$.

Second \textbf{para}.
\begin{equation}
  E = mc^2
\end{equation}
\subsection*{Details}
% a comment
\begin{figure}[h]
  \centering
  \input{figures/Document_2-3}
  \caption{ssdsd}
  \label{fig:a}
\end{figure}
\begin{itemize}
  \item one
\end{itemize}
\[ a + b \]
\bibliographystyle{unsrt}
\bibliography{refs}
\end{document}
`;

describe("blocks", () => {
  it("splits a document", () => {
    const b = splitBlocks(doc);
    expect(b.map((x) => x.kind)).toEqual(["preamble", "code", "heading", "para", "para", "math", "heading", "code", "figure", "list", "math", "code", "tail"]);
    const para = b[3];
    expect(doc.slice(para.start, para.end)).toBe("First paragraph line one\ncontinues here with $x$.");
    expect(doc.slice(b[2].title!.start, b[2].title!.end)).toBe("Introduction");
    expect(b[8].figure!.caption!.text).toBe("ssdsd");
    expect(doc.slice(b[11].start, b[11].end)).toBe("\\bibliographystyle{unsrt}\n\\bibliography{refs}");
    const nums = headingNumbers(b);
    expect(nums.get(b[2])).toBe("1");
    expect(nums.get(b[6])).toBeUndefined();
  });
  it("knows command-only lines", () => {
    expect(commandOnly("\\maketitle")).toBe(true);
    expect(commandOnly("\\bibliography{refs} % x")).toBe(true);
    expect(commandOnly("\\textbf{x} more")).toBe(false);
    expect(commandOnly("\\noindent Some text")).toBe(false);
  });
});
