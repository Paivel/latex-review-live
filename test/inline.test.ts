import { describe, expect, it } from "vitest";
import { Inline, compress, serialize, tokenize } from "../src/visual/inline";

const samples = [
  String.raw`Plain text with 50\% yield \& more_ stuff`,
  String.raw`We used \textbf{bold \emph{nested}} and $x^2 + \alpha$ here~\cite{a,b} see Fig.~\ref{fig:one}.`,
  String.raw`Line one
line two % a comment
line three \\ next \( a \) and \[ b \] and $$c$$ end`,
  String.raw`Compound \rcmpd{A:2a} and \cmpd{x} and \LaTeX{} and \, thin \- hy {\bf group} ^ & # } stray \textbf*{x} \foo[opt]{a}{b}`,
  String.raw`Unclosed $ dollar and \textbf{unclosed`,
  "",
];

describe("inline", () => {
  it("round-trips", () => {
    for (const s of samples) expect(serialize(tokenize(s))).toBe(s);
  });
  it("keeps offsets", () => {
    const s = String.raw`ab \% cd \textbf{ef} $x$`;
    const check = (nodes: Inline[]) => {
      for (const n of nodes) {
        if (n.t === "text") expect(n.s === "%" ? s.slice(n.at, n.at + 2) : s.slice(n.at, n.at + n.s.length)).toBe(n.s === "%" ? "\\%" : n.s);
        else if (n.t === "atom") expect(s.slice(n.at, n.at + n.src.length)).toBe(n.src);
        else { expect(s.slice(n.at, n.end)).toBe("\\textbf{ef}"); check(n.kids); }
      }
    };
    check(tokenize(s));
  });
  it("shows cites and refs", () => {
    const t = tokenize(String.raw`\cite{a,b,c,z}\ref{f}`, { cites: new Map([["a", "1"], ["b", "2"], ["c", "3"]]), labels: new Map([["f", "2"]]) });
    expect(t.map((n) => (n.t === "atom" ? n.show : ""))).toEqual(["1–3,?", "2"]);
    expect(compress(["1", "2", "4"])).toBe("1,2,4");
  });
  it("escapes typed text", () => {
    expect(serialize([{ t: "text", s: "50% & {x} \\ ^ ~ a b", at: 0 }])).toBe(String.raw`50\% \& \{x\} \textbackslash{} \^{} \textasciitilde{} a b`);
  });
});
