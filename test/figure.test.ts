import { describe, expect, it } from "vitest";
import { allFigures, fieldEdit, figureAt, graphicWidth, graphicsPaths, imageCandidates, moveEdits, placementEdit, spanEdits, widthEdit } from "../src/visual/figure";

const doc = String.raw`\graphicspath{{figures/}{img/}}
text
\begin{figure}[h]
  \centering
  \input{figures/Document_2-3}
  \caption{A {nested} caption \% here}
  \label{fig:one}
\end{figure}
% \begin{figure} commented
\begin{scheme*}
  \includegraphics[width=3cm]{scheme1}
\end{scheme*}
`;
const apply = (t: string, e: { start: number; end: number; text: string }) => t.slice(0, e.start) + e.text + t.slice(e.end);

describe("figures", () => {
  it("finds the figure at the cursor", () => {
    const f = figureAt(doc, doc.indexOf("centering"))!;
    expect(f.env).toBe("figure");
    expect(f.graphics).toMatchObject([{ kind: "input", path: "figures/Document_2-3" }]);
    expect(f.caption!.text).toBe(String.raw`A {nested} caption \% here`);
    expect(f.label!.text).toBe("fig:one");
    expect(figureAt(doc, doc.indexOf("text"))).toBeNull();
    expect(allFigures(doc).map((x) => x.env)).toEqual(["figure", "scheme*"]);
  });
  it("edits and inserts fields", () => {
    const f = figureAt(doc, doc.indexOf("centering"))!;
    expect(apply(doc, fieldEdit(doc, f, "caption", "New"))).toContain("\\caption{New}\n  \\label{fig:one}");
    const s = figureAt(doc, doc.indexOf("scheme1"))!;
    let t = apply(doc, fieldEdit(doc, s, "label", "sch:1"));
    expect(t).toContain("{scheme1}\n  \\label{sch:1}\n\\end{scheme*}");
    const s2 = figureAt(t, t.indexOf("scheme1"))!;
    t = apply(t, fieldEdit(t, s2, "caption", "Cap"));
    expect(t).toContain("{scheme1}\n  \\caption{Cap}\n  \\label{sch:1}\n\\end{scheme*}");
  });
  it("lists image candidates", () => {
    expect(graphicsPaths(doc)).toEqual(["figures/", "img/"]);
    expect(imageCandidates({ kind: "input", path: "figures/Document_2-3" }, [])).toEqual(["figures/Document_2-3.pdf", "figures/Document_2-3.svg", "figures/Document_2-3.png"]);
    expect(imageCandidates({ kind: "graphics", path: "a.png" }, ["figures/"])).toEqual(["a.png", "figures/a.png"]);
  });
});

describe("figure size, placement, columns and moving", () => {
  const apply = (t: string, es: { start: number; end: number; text: string }[]) =>
    [...es].sort((a, b) => b.start - a.start).reduce((s, e) => s.slice(0, e.start) + e.text + s.slice(e.end), t);
  const src = String.raw`Text before.

\begin{figure}[ht]
  \centering
  \includegraphics[width=3cm,angle=90]{pic}
  \caption{A picture.}
\end{figure}

Middle paragraph.

\begin{figure}
  \input{figures/drawing}
\end{figure}

Last paragraph.
`;
  it("sets width= and drops other size options", () => {
    const f = allFigures(src)[0];
    const e = widthEdit(src, f.graphics[0], 0.5)!;
    expect(apply(src, [e])).toContain(String.raw`\includegraphics[width=0.5\linewidth,angle=90]{pic}`);
    expect(apply(src, [widthEdit(src, f.graphics[0], 1)!])).toContain(String.raw`\includegraphics[width=\linewidth,angle=90]{pic}`);
  });
  it("wraps an \\input drawing in \\resizebox, then edits the box", () => {
    const f = allFigures(src)[1];
    const once = apply(src, [widthEdit(src, f.graphics[0], 0.75)!]);
    expect(once).toContain(String.raw`\resizebox{0.75\linewidth}{!}{\input{figures/drawing}}`);
    const g = allFigures(once)[1].graphics[0];
    expect(graphicWidth(g)).toEqual({ frac: 0.75 });
    expect(apply(once, [widthEdit(once, g, 0.5)!])).toContain(String.raw`\resizebox{0.5\linewidth}{!}{\input{figures/drawing}}`);
  });
  it("sets, adds and removes the placement", () => {
    const [a, b] = allFigures(src);
    expect(apply(src, [placementEdit(src, a, "t")!])).toContain(String.raw`\begin{figure}[t]`);
    expect(apply(src, [placementEdit(src, b, "htbp")!])).toContain(String.raw`\begin{figure}[htbp]`);
    expect(apply(src, [placementEdit(src, a, "")!])).toContain("\\begin{figure}\n  \\centering");
  });
  it("switches figure and figure*", () => {
    const a = allFigures(src)[0];
    const wide = apply(src, spanEdits(src, a)!);
    expect(wide).toContain(String.raw`\begin{figure*}[ht]`);
    expect(wide).toContain(String.raw`\end{figure*}`);
    expect(apply(wide, spanEdits(wide, allFigures(wide)[0])!)).toBe(src);
  });
  it("moves a float before another block, leaving no extra blank lines", () => {
    const a = allFigures(src)[0];
    const moved = apply(src, moveEdits(src, a, src.indexOf("Last paragraph"))!);
    expect(moved.startsWith("Text before.\n\nMiddle paragraph.\n\n\\begin{figure}\n  \\input")).toBe(true);
    expect(moved).toContain("\\end{figure}\n\n\\begin{figure}[ht]");
    expect(moved.endsWith("\\end{figure}\n\nLast paragraph.\n")).toBe(true);
    expect(moveEdits(src, a, src.indexOf("\\centering"))).toBeNull();
  });
});
