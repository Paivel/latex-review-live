import { describe, expect, it } from "vitest";
import { appendText, bibKeys, bibTargets, citeKeys, missingKeys } from "../src/bib/keys";

describe("bib keys", () => {
  it("finds keys in cite-like commands", () => {
    const tex = String.raw`\cite{a, b} \citep[p.~3]{c} \autocite[see][12]{d} % \cite{x}
\textcite*{e}\nocite{*} \parencite{azpilcueta-nicolasDearomatization}`;
    expect(citeKeys(tex)).toEqual(["a", "b", "c", "d", "e", "azpilcueta-nicolasDearomatization"]);
  });
  it("finds bib targets", () => {
    expect(bibTargets(String.raw`\bibliography{refs, other.bib} \addbibresource{lib.bib} %\bibliography{no}`)).toEqual([
      { file: "refs.bib", kind: "bibtex" },
      { file: "other.bib", kind: "bibtex" },
      { file: "lib.bib", kind: "biblatex" },
    ]);
  });
  it("reads bib keys and missing ones", () => {
    const bib = "@article{a,\n title={x}}\n@Book{ b ,}\n@comment{c,}";
    expect([...bibKeys(bib)]).toEqual(["a", "b"]);
    expect(missingKeys(["a", "c", "d"], [bib])).toEqual(["c", "d"]);
  });
  it("appends with separation", () => {
    expect(appendText("", "@a{x,}\n")).toBe("@a{x,}\n");
    expect(appendText("@a{x,}", "@a{y,}")).toBe("\n\n@a{y,}\n");
    expect(appendText("@a{x,}\n", "@a{y,}")).toBe("\n@a{y,}\n");
  });
});
