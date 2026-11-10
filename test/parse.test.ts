import { describe, expect, it } from "vitest";
import { compressNumbers, formatCe, formatNum, formatUnit, noRefs, parseLatex, Piece, Refs } from "../src/preview/parse";
import { readAux } from "../src/preview/aux";

/** What live preview shows when the cursor is elsewhere. */
function look(src: string, refs?: Refs, cursor?: number): string {
  const pieces = parseLatex(src, refs);
  const hides = pieces.filter((p) => p.hide && !(cursor !== undefined && p.owner[0] <= cursor && p.owner[1] >= cursor));
  // Outer hides may contain inner ones; keep the outermost.
  hides.sort((a, b) => a.start - b.start || b.end - a.end);
  let out = "";
  let i = 0;
  for (const p of hides) {
    if (p.start < i) continue;
    out += src.slice(i, p.start) + (p.text ?? "");
    i = p.end;
  }
  return out + src.slice(i);
}
const styles = (src: string) => parseLatex(src).filter((p) => p.style).map((p) => [src.slice(p.start, p.end), p.style]);

describe("live preview", () => {
  it("hides formatting commands and styles their text", () => {
    expect(look("a \\textbf{bold \\emph{it}} b")).toBe("a bold it b");
    expect(styles("\\textbf{x}")).toEqual([["x", "bold"]]);
  });

  it("shows the code of the element under the cursor", () => {
    const src = "a \\textbf{bold} b \\emph{c}";
    expect(look(src, undefined, 5)).toBe("a \\textbf{bold} b c");
  });

  it("turns headings, lists and quotes into text", () => {
    const src = "\\section{Intro}\n\\begin{itemize}\n\\item one\n\\item two\n\\end{itemize}\n\\begin{enumerate}\n\\item a\n\\item b\n\\end{enumerate}\n``q'' -- x --- y";
    expect(look(src)).toBe("Intro\n\n• one\n• two\n\n\n1. a\n2. b\n\n“q” – x — y");
  });

  it("leaves the preamble as source", () => {
    const src = "\\documentclass{article}\n\\usepackage{x}\n\\begin{document}\n\\textbf{a}\n\\end{document}";
    expect(look(src)).toBe("\\documentclass{article}\n\\usepackage{x}\n\na\n");
  });

  it("shows references and citations from the .aux", () => {
    const refs = noRefs();
    readAux("\\newlabel{fig:a}{{3}{5}{Cap}{figure.3}{}}\n\\newlabel{fig:a@cref}{{[figure][3][]3}{5}}\n\\bibcite{smith}{1}\n\\bibcite{jones}{2}\n\\bibcite{lee}{3}", refs);
    expect(look("see \\ref{fig:a}, \\cref{fig:a} and \\cite{smith,jones,lee}, \\cite{x}", refs)).toBe("see 3, fig.\u00a03 and [1–3], [x]");
    expect(look("\\ref{nope}")).toBe("??");
  });

  it("conceals math symbols and scripts", () => {
    expect(look("$\\alpha \\to \\beta^2 + x_{12}$")).toBe("α → β² + x₁₂");
    expect(look("$\\frac{a}{b} + \\frac{x+1}{2}$")).toBe("a/b + (x+1)/2");
    expect(look("$25^\\circ$C")).toBe("25°C");
    expect(look("$x^{n+1}_{\\mathrm{max}}$")).toBe("xⁿ⁺¹_{max}");
  });

  it("formats chemistry and units", () => {
    expect(look("\\ce{H2SO4} and \\ce{Fe^{3+}} \\ce{A + B -> C}")).toBe("H₂SO₄ and Fe³⁺ A + B → C");
    expect(look("\\SI{5}{\\milli\\gram\\per\\milli\\litre} at \\qty{25}{\\celsius}")).toBe("5\u00a0mg/mL at 25\u00a0°C");
  });

  it("keeps comments and unknown commands visible", () => {
    expect(look("text % note\n\\foo{bar}")).toBe("text % note\n\\foo{bar}");
    expect(styles("x % c")).toEqual([["% c", "muted"]]);
  });

  it("handles escapes, accents and footnotes", () => {
    expect(look("50\\% \\& Schr\\\"odinger\\footnote{see \\textit{x}}")).toBe("50% & Schrödinger [see x]");
    expect(look("Fig.~1\\\\next")).toBe("Fig.\u00a01 ↵next");
  });

  it("figures become a short marker", () => {
    const src = "\\begin{figure}[h]\n\\centering\n\\includegraphics[width=3cm]{figures/scheme}\n\\caption{A scheme}\\label{fig:s}\n\\end{figure}";
    expect(look(src)).toBe("▣ Figure\n\\centering\n🖼 figures/scheme\nCaption: A scheme\n");
  });

  it("does not hang on broken input", () => {
    for (const s of ["\\textbf{", "$x", "\\begin{equation} x", "\\frac{a}", "\\cite[", "\\", "a_", "\\section*[x"]) {
      expect(() => parseLatex(s)).not.toThrow();
    }
  });
});

describe("formatters", () => {
  it("numbers", () => {
    expect(formatNum("1.5e-3")).toBe("1.5×10⁻³");
    expect(formatNum("10 +- 2")).toBe("10 ± 2");
  });
  it("units", () => {
    expect(formatUnit("\\kilo\\joule\\per\\mole")).toBe("kJ/mol");
    expect(formatUnit("\\square\\metre")).toBe("m²");
    expect(formatUnit("\\metre\\second")).toBe("m·s");
    expect(formatUnit("mg.mL^{-1}")).toBe("mg·mL⁻¹");
  });
  it("chemistry", () => {
    expect(formatCe("SO4^2-")).toBe("SO₄²⁻");
    expect(formatCe("2 H2 + O2 <=> 2 H2O")).toBe("2 H₂ + O₂ ⇌ 2 H₂O");
  });
  it("citation ranges", () => {
    expect(compressNumbers(["3", "1", "2", "5", "6"])).toEqual(["1–3", "5, 6"]);
  });
});
