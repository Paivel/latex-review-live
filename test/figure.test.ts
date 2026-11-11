import { describe, expect, it } from "vitest";
import { allFigures, fieldEdit, figureAt, graphicsPaths, imageCandidates } from "../src/visual/figure";

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
    expect(f.graphics).toEqual([{ kind: "input", path: "figures/Document_2-3" }]);
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
