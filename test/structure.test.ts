import { describe, expect, it } from "vitest";
import { commandArg, envBox, graphicSizeForTest, inputPaths, onlyCommands, parseList, theoremEnvs } from "./structure-helpers";
import { buildDoc } from "../src/visual/model";

describe("lists", () => {
  it("reads items, labels and nested lists", () => {
    const t = String.raw`\begin{itemize}
  \item First \textbf{one}
  \item[*] Second
  \begin{enumerate}
    \item inner
  \end{enumerate}
  \item Third % note
\end{itemize}`;
    const l = parseList(t, 0)!;
    expect(l.env).toBe("itemize");
    expect(l.items.map((i) => t.slice(i.text.start, i.text.end))).toEqual(["First \\textbf{one}", "Second", "Third % note"]);
    expect(t.slice(l.items[1].label!.start, l.items[1].label!.end)).toBe("*");
    expect(l.items[1].sub[0].items.map((i) => t.slice(i.text.start, i.text.end))).toEqual(["inner"]);
  });
});

describe("title, theorems, inputs", () => {
  it("finds \\title in the preamble", () => {
    const t = "\\title{My \\emph{paper}}\n\\author{A \\and B}";
    const r = commandArg(t, "title")!;
    expect(t.slice(r.start, r.end)).toBe("My \\emph{paper}");
  });
  it("knows theorem-like environments", () => {
    const th = theoremEnvs("\\newtheorem{hyp}{Hypothesis}\n\\newtheorem*{obs}{Observation}");
    expect(th.get("hyp")).toEqual({ title: "Hypothesis", numbered: true });
    expect(th.get("obs")?.numbered).toBe(false);
    const t = "\\begin{hyp}[Main] Every $x$. \\end{hyp}";
    const b = envBox(t, 0, th)!;
    expect(b.title).toBe("Hypothesis");
    expect(t.slice(b.note!.start, b.note!.end)).toBe("Main");
    expect(t.slice(b.inner.start, b.inner.end)).toBe("Every $x$.");
  });
  it("reads \\input lines", () => {
    expect(inputPaths("\\input{chapters/intro}\n\\include{b} % c\n\\import{dir/}{x.tex}")).toEqual(["chapters/intro", "b", "dir/x.tex"]);
    expect(onlyCommands("\\input{a}\n% x\n\\include{b}", ["input", "include"])).toBe(true);
    expect(onlyCommands("\\input{a} text", ["input"])).toBe(false);
  });
  it("reads \\includegraphics sizes", () => {
    expect(graphicSizeForTest("width=0.6\\linewidth")).toEqual({ frac: 0.6 });
    expect(graphicSizeForTest("width=\\textwidth")).toEqual({ frac: 1 });
    expect(graphicSizeForTest("width=5cm").pt).toBeCloseTo(142.26, 1);
    expect(graphicSizeForTest("scale=0.5")).toEqual({ scale: 0.5 });
  });
});

describe("model", () => {
  const text = String.raw`\documentclass{article}
\newtheorem{theorem}{Theorem}
\title{A Title}
\author{Me}
\begin{document}
\maketitle
\begin{abstract}
Short summary.
\end{abstract}
\section{Intro}\label{sec:intro}
See \cref{fig:a}, \Cref{eq:e} and \autoref{sec:intro}.
\begin{itemize}
  \item one
  \item two
\end{itemize}
\begin{theorem}
True.
\end{theorem}
\input{chapters/x}
\begin{equation}
a=b \label{eq:e}
\end{equation}
\begin{figure}
\includegraphics[width=0.5\linewidth]{p.png}
\caption{C}\label{fig:a}
\end{figure}
\end{document}
`;
  const d = buildDoc({ text, uri: "u", version: 1, name: "m", look: { labels: new Map([["fig:a", "1"], ["eq:e", "1"], ["sec:intro", "1"]]) }, tracking: false, marks: [], images: () => [], inputFile: (p) => (p === "chapters/x" ? "/abs/chapters/x.tex" : undefined) });
  it("draws structure", () => {
    const tb = d.blocks.find((b) => b.titleBlock)!;
    expect(tb.titleBlock!.title!.src).toBe("A Title");
    expect(tb.hideSource).toBe(true);
    const ab = d.blocks.findIndex((b) => b.wrap?.env === "abstract" && b.wrap.side === "begin");
    expect(d.blocks[ab].wrap!.title).toBe("Abstract");
    expect(d.blocks[ab + 1].within).toBe("abstract");
    expect(d.blocks[ab + 1].src.trim()).toBe("Short summary.");
    expect(d.blocks[ab + 2].wrap?.side).toBe("end");
    expect(d.blocks.find((b) => b.envbox?.title === "Theorem")!.envbox!.num).toBe("1");
    expect(d.blocks.find((b) => b.list)!.list!.items.map((i) => i.text.src)).toEqual(["one", "two"]);
    expect(d.blocks.find((b) => b.inputs)!.inputs).toEqual([{ path: "chapters/x", file: "/abs/chapters/x.tex" }]);
  });
  it("names references by kind", () => {
    const p = d.blocks.find((b) => b.kind === "para" && b.src.startsWith("See"))!;
    const shows = (p.nodes ?? []).filter((n: any) => n.t === "atom").map((n: any) => n.show);
    expect(shows).toEqual(["fig. 1", "Equation (1)", "Section 1"]);
  });
});

describe("achemso", () => {
  const text = `\\documentclass[journal=jacsat]{achemso}
\\author{Andrew Other}
\\affiliation[U]{Dept, Unknown University}
\\author{Ken Leader}
\\email{k@u.uu}
\\alsoaffiliation[S]{Second University}
\\title[Short]{A demo of \\textsf{achemso}\\footnote{note}}
\\begin{document}
%%%%%%%%
%% a comment
%%%%%%%%
\\begin{abstract}
  First paragraph.

  Second paragraph.
\\end{abstract}
\\begin{suppinfo}
\\begin{itemize}
  \\item File
\\end{itemize}
\\end{suppinfo}
\\end{document}
`;
  const d = buildDoc({ text, uri: "u", version: 1, name: "m", look: {}, tracking: false, marks: [], images: () => [] });
  it("prints the title block without \\maketitle", () => {
    const t = d.blocks.find((b) => b.virtual)!.titleBlock!;
    expect(t.title!.src).toContain("A demo");
    expect(t.authors.map((a) => a.src)).toEqual(["Andrew Other", "Ken Leader"]);
    expect(t.affiliations.map((a) => [a.mark, a.text.src])).toEqual([["\u2021", "Dept, Unknown University"], ["\u00b6", "Second University"]]);
    // \affiliation goes to both earlier authors; \alsoaffiliation and \email to the last one.
    expect(t.authorMarks).toEqual(["\u2021", "*,\u00b6"]);
    expect(t.emails).toEqual(["k@u.uu"]);
  });
  it("splits open environments into blocks and folds comments", () => {
    expect(d.blocks.filter((b) => b.within === "abstract" && b.kind === "para").length).toBe(2);
    expect(d.blocks.some((b) => b.within === "suppinfo" && b.list)).toBe(true);
    expect(d.blocks.some((b) => b.commentOnly)).toBe(true);
  });
});
