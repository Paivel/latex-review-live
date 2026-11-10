import { Refs } from "./parse";

/** The brace-balanced group that opens at `from`, and the offset just past it. */
function group(text: string, from: number): [string, number] | null {
  if (text[from] !== "{") return null;
  let depth = 0;
  for (let k = from; k < text.length; k++) {
    const ch = text[k];
    if (ch === "\\") k++;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return [text.slice(from + 1, k), k + 1];
  }
  return null;
}

/** A number as TeX wrote it (`{\relax 3}`, `{\textup {(3)}}`), without its markup. */
const plain = (v: string) => v.replace(/\\[A-Za-z@]+\s*/g, "").replace(/[{}]/g, "").trim();

/**
 * Labels and citation numbers from a LaTeX .aux file, and the chapter .aux
 * files it pulls in with \@input (to be read the same way).
 */
export function readAux(aux: string, into: Refs): { refs: Refs; inputs: string[] } {
  for (const m of aux.matchAll(/\\newlabel\{([^}]*)\}/g)) {
    const key = m[1];
    if (key.endsWith("@cref")) continue;
    const outer = group(aux, m.index! + m[0].length);
    const num = outer && group(outer[0], 0);
    if (num && !into.labels.has(key)) into.labels.set(key, plain(num[0]));
  }
  for (const m of aux.matchAll(/\\bibcite\{([^}]*)\}/g)) {
    const g = group(aux, m.index! + m[0].length);
    if (!g) continue;
    // natbib writes {{1}{2020}{{Author}}{{}}}; plain BibTeX writes {1}.
    const first = group(g[0], 0);
    const v = plain(first ? first[0] : g[0]);
    if (v && !into.cites.has(m[1])) into.cites.set(m[1], v);
  }
  // biblatex: \abx@aux@number{refcontext}{key}{refsection}{sortingtemplate}{number}
  for (const m of aux.matchAll(/\\abx@aux@number\{[^}]*\}\{([^}]+)\}\{[^}]*\}\{[^}]*\}\{([^}]+)\}/g)) {
    if (!into.cites.has(m[1])) into.cites.set(m[1], m[2]);
  }
  return { refs: into, inputs: [...aux.matchAll(/\\@input\{([^}]+\.aux)\}/g)].map((m) => m[1]) };
}
