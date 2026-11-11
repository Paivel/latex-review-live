// The reference list from a BibTeX .bbl file, cleaned to inline LaTeX the visual editor can draw.
import { groupEnd } from "./inline";

export interface BibEntry {
  key: string;
  /** The label LaTeX prints: the optional [..] of \bibitem, or the cite number. */
  label: string;
  /** The entry as simple inline LaTeX (\textit, \textbf and text). */
  tex: string;
}

/** Replace \cmd{a}{b}.. by a function of its arguments, brace-aware. */
function replaceCmd(s: string, name: string, n: number, f: (args: string[]) => string): string {
  const re = new RegExp(`\\\\${name}\\b\\s*`, "g");
  let out = "";
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    let k = m.index + m[0].length;
    const args: string[] = [];
    while (args.length < n) {
      while (s[k] === " ") k++;
      const e = groupEnd(s, k);
      if (e < 0) break;
      args.push(s.slice(k + 1, e - 1));
      k = e;
    }
    if (args.length < n) continue;
    out += s.slice(last, m.index) + f(args);
    last = k;
    re.lastIndex = k;
  }
  return out + s.slice(last);
}

export function cleanBibTex(raw: string): string {
  let s = raw.replace(/(^|[^\\])%.*$/gm, "$1");
  s = s.replace(/\\mciteBstWouldAddEndPunct(true|false)/g, "").replace(/\\mciteSetBstMidEndSepPunct\{[^{}]*\}\{[^{}]*\}\{[^{}]*\}/g, "");
  s = s.replace(/\\EndOfBibitem|\\mciteSetBstSublistMode\{[^}]*\}|\\mciteSetBstMaxWidthForm\{[^}]*\}\{[^}]*\}|\\mciteSetBstSublistLabelBeginEnd\{[^}]*\}\{[^}]*\}\{[^}]*\}/g, "");
  s = s.replace(/\\mcitedefaultmidpunct|\\mcitedefaultendpunct|\\mcitedefaultseppunct|\\mciteSetBstSublistLabelBeginEnd/g, "");
  for (const c of ["bibinfo", "bibfield", "bibnamefont", "bibfnamefont", "citenamefont", "bibsnamefont"]) s = replaceCmd(s, c, c.startsWith("bib") && (c === "bibinfo" || c === "bibfield") ? 2 : 1, (a) => a[a.length - 1]);
  s = replaceCmd(s, "href", 2, (a) => a[1]);
  s = replaceCmd(s, "url", 1, (a) => a[0]);
  s = replaceCmd(s, "doi", 1, (a) => `doi:${a[0]}`);
  s = replaceCmd(s, "Eprint", 2, (a) => a[1]);
  s = s.replace(/\{\\(?:em|it|itshape)\s+/g, "\\textit{").replace(/\{\\(?:bf|bfseries)\s+/g, "\\textbf{");
  s = s.replace(/\\(?:newblock|relax|mbox|nolinkurl|penalty\d*|allowbreak)\b\s*/g, " ");
  s = s.replace(/\\(emph|textit|textbf|textsl)\b/g, (_m, c) => `\\${c === "emph" || c === "textsl" ? "textit" : c}`);
  // Bare groups {X} -> X (outside \textit/\textbf arguments they only protect case).
  for (let k = 0; k < 4; k++) s = s.replace(/(^|[^\\a-zA-Z])\{([^{}\\]*)\}/g, "$1$2");
  // Any other command: drop it, keep its arguments.
  s = s.replace(/\\(?!textit\b|textbf\b|[%&_#${}~])[a-zA-Z@]+\*?\s*/g, "");
  for (let k = 0; k < 3; k++) s = s.replace(/(^|[^\\a-zA-Z])\{([^{}\\]*)\}/g, "$1$2");
  s = s.replace(/---/g, "—").replace(/--/g, "–");
  return s.replace(/~/g, " ").replace(/\s+/g, " ").replace(/\s+([.,;:])/g, "$1").trim();
}

export function parseBbl(bbl: string, cites?: Map<string, string>): BibEntry[] {
  const begin = bbl.indexOf("\\begin{thebibliography}");
  const end = bbl.lastIndexOf("\\end{thebibliography}");
  if (begin < 0) return [];
  const body = bbl.slice(begin, end < 0 ? bbl.length : end);
  const items: BibEntry[] = [];
  const re = /\\bibitem\s*(\[(?:[^\]{}]|\{[^}]*\})*\])?\s*\{([^}]*)\}/g;
  const ms = [...body.matchAll(re)];
  ms.forEach((m, i) => {
    const from = m.index! + m[0].length;
    const to = i + 1 < ms.length ? ms[i + 1].index! : body.length;
    const key = m[2].trim();
    const opt = m[1] ? cleanBibTex(m[1].slice(1, -1)) : "";
    const label = cites?.get(key) ?? (opt && opt.length < 12 ? opt : String(i + 1));
    items.push({ key, label, tex: cleanBibTex(body.slice(from, to)) });
  });
  return items;
}
