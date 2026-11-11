import { describe, expect, it } from "vitest";
import { parseBbl } from "../src/visual/bbl";

const achemso = String.raw`\providecommand*\mciteSetBstSublistMode[1]{}
\begin{thebibliography}{3}
\providecommand*\natexlab[1]{#1}
\mciteSetBstSublistMode{storeinter}
\mciteSetBstMaxWidthForm{subitem}{(\alph{mcitesubitemcount})}
\mciteSetBstSublistLabelBeginEnd
  {\mcitemaxwidthsubitemform\space}
  {\relax}
  {\relax}

\bibitem[Azpilcueta-Nicolas \latin{et~al.}(2023)Azpilcueta-Nicolas, Meng,
  Edelmann, and Lumb]{azp}
Azpilcueta-Nicolas,~C.~R.; Meng,~D.; Edelmann,~S.; Lumb,~J.-P. Dearomatization
  of {{Biaryls}} through {{Polarity Mismatched Radical Spirocyclization}}.
  \emph{Angewandte Chemie International Edition} \textbf{2023}, \emph{n/a},
  e202215422\relax
\mciteBstWouldAddEndPuncttrue
\mciteSetBstMidEndSepPunct{\mcitedefaultmidpunct}
{\mcitedefaultendpunct}{\mcitedefaultseppunct}\relax
\EndOfBibitem
\bibitem[Liu(2021)]{liu}
Liu,~A.-D. Light-Promoted {C--H}. \emph{J. Org. Chem.} \textbf{2021}, \emph{86}, 1--10\relax
\mciteBstWouldAddEndPuncttrue
\mciteSetBstMidEndSepPunct{\mcitedefaultmidpunct}
{\mcitedefaultendpunct}{\mcitedefaultseppunct}\relax
\EndOfBibitem
\end{thebibliography}
`;
const plain = String.raw`\begin{thebibliography}{1}

\bibitem{azp}
Carlos~R. {Azpilcueta-Nicolas}, Derek Meng.
\newblock Dearomatization of {{Biaryls}}.
\newblock {\em Angewandte Chemie International Edition}, n/a(n/a):e202215422.

\end{thebibliography}`;

describe("bbl", () => {
  it("reads achemso", () => {
    const e = parseBbl(achemso, new Map([["azp", "1"], ["liu", "2"]]));
    expect(e.map((x) => x.label)).toEqual(["1", "2"]);
    expect(e[0].tex).toBe(String.raw`Azpilcueta-Nicolas, C. R.; Meng, D.; Edelmann, S.; Lumb, J.-P. Dearomatization of Biaryls through Polarity Mismatched Radical Spirocyclization. \textit{Angewandte Chemie International Edition} \textbf{2023}, \textit{n/a}, e202215422`);
    expect(e[1].tex).toBe(String.raw`Liu, A.-D. Light-Promoted C–H. \textit{J. Org. Chem.} \textbf{2021}, \textit{86}, 1–10`);
  });
  it("reads plain", () => {
    const e = parseBbl(plain);
    expect(e[0]).toEqual({ key: "azp", label: "1", tex: String.raw`Carlos R. Azpilcueta-Nicolas, Derek Meng. Dearomatization of Biaryls. \textit{Angewandte Chemie International Edition}, n/a(n/a):e202215422.` });
  });
});
