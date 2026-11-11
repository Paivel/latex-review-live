// Inline LaTeX as a small tree the visual editor can show and edit, and back.
// serialize(tokenize(s)) === s for any s: what the user does not touch is kept byte for byte.

export type Inline =
  | { t: "text"; s: string; at: number }
  | { t: "fmt"; cmd: string; kids: Inline[]; at: number; end: number }
  | Atom;

export interface Atom {
  t: "atom";
  /** The exact source. */
  src: string;
  /** Offset of the source in the tokenized string (plus the base passed to tokenize). */
  at: number;
  kind: "math" | "cite" | "ref" | "cmpd" | "cmd" | "comment" | "space" | "break";
  /** What to show for cite/ref/cmpd/cmd. */
  show?: string;
  /** TeX for KaTeX, for math atoms. */
  tex?: string;
}

export const FORMAT_CMDS = ["textbf", "textit", "emph", "underline", "texttt", "textsc", "textsf", "textrm", "textup", "textsl", "latin"];
const CITE = /^(?:[a-zA-Z]*cite[a-zA-Z]*|nocite)$/;
const REF = /^(?:ref|eqref|cref|Cref|autoref|pageref|vref|nameref)$/;
const CMPD = /^(?:cmpd|rcmpd|refcmpd|cmpdplain)$/;
const ESCAPABLE = "%&_#${}";
/** TeX accent commands and the combining marks they stand for. */
const ACCENTS: Record<string, string> = { '"': "\u0308", "'": "\u0301", "`": "\u0300", "^": "\u0302", "~": "\u0303", "=": "\u0304", ".": "\u0307" };
const LIGATURES: Record<string, string> = { "---": "\u2014", "--": "\u2013", "``": "\u201c", "''": "\u201d" };

export interface Lookup {
  cites?: Map<string, string>;
  labels?: Map<string, string>;
  /** What a label names ("figure", "equation", "section"…), for \cref, \Cref and \autoref. */
  kinds?: Map<string, string>;
  symbols?: Record<string, string>;
}

/** The brace group opening at i: index just past its closing brace, or -1. */
export function groupEnd(s: string, i: number, open = "{", close = "}"): number {
  if (s[i] !== open) return -1;
  let depth = 0;
  for (let k = i; k < s.length; k++) {
    const c = s[k];
    if (c === "\\") { k++; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return k + 1;
  }
  return -1;
}

/** Optional [..] groups then {..} groups right after a command name. */
function args(s: string, i: number, maxBraces: number): { end: number; braces: string[]; opts: string[] } {
  const braces: string[] = [];
  const opts: string[] = [];
  let k = i;
  for (;;) {
    let j = k;
    while (s[j] === " " || s[j] === "\t") j++;
    if (s[j] === "[" && braces.length === 0) {
      const e = groupEnd(s, j, "[", "]");
      if (e < 0) break;
      opts.push(s.slice(j + 1, e - 1));
      k = e;
      continue;
    }
    if (s[j] === "{" && braces.length < maxBraces) {
      const e = groupEnd(s, j);
      if (e < 0) break;
      braces.push(s.slice(j + 1, e - 1));
      k = e;
      continue;
    }
    break;
  }
  return { end: k, braces, opts };
}

/**
 * Text nodes never contain an escape, so a character k of a text node sits at
 * source offset at + k; an escaped character is a text node of its own.
 */
export function tokenize(s: string, look: Lookup = {}, base = 0): Inline[] {
  const out: Inline[] = [];
  let text = "";
  let textAt = 0;
  const flush = () => { if (text) { out.push({ t: "text", s: text, at: base + textAt }); text = ""; } };
  const atom = (a: Omit<Atom, "at">) => { flush(); out.push({ ...a, at: base + i } as Atom); };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") {
      const n = s[i + 1];
      if (n === undefined) { atom({ t: "atom", src: "\\", kind: "cmd", show: "\\" }); i++; continue; }
      if (ESCAPABLE.includes(n)) { flush(); out.push({ t: "text", s: n, at: base + i }); i += 2; continue; }
      if (n === "\\") {
        let e = i + 2;
        if (s[e] === "*") e++;
        if (s[e] === "[") { const g = groupEnd(s, e, "[", "]"); if (g > 0) e = g; }
        atom({ t: "atom", src: s.slice(i, e), kind: "break", show: "↵" });
        i = e;
        continue;
      }
      if (n === "(") {
        const e = s.indexOf("\\)", i + 2);
        if (e >= 0) { atom({ t: "atom", src: s.slice(i, e + 2), kind: "math", tex: s.slice(i + 2, e) }); i = e + 2; continue; }
      }
      if (n === "[") {
        const e = s.indexOf("\\]", i + 2);
        if (e >= 0) { atom({ t: "atom", src: s.slice(i, e + 2), kind: "math", tex: "\\displaystyle " + s.slice(i + 2, e) }); i = e + 2; continue; }
      }
      if (ACCENTS[n] !== undefined) {
        // \"o, \'{e}, \^a: the accented letter, as one atom.
        let e = i + 2;
        let letter = "";
        if (s[e] === "{") { const g = groupEnd(s, e); if (g > 0) { letter = s.slice(e + 1, g - 1).replace(/^\\/, ""); e = g; } }
        else if (/[a-zA-Z]/.test(s[e] ?? "")) { letter = s[e]; e++; }
        if (letter.length === 1) {
          atom({ t: "atom", src: s.slice(i, e), kind: "space", show: ((letter === "i" ? "\u0131" : letter) + ACCENTS[n]).normalize("NFC") });
          i = e;
          continue;
        }
      }
      if (!/[a-zA-Z@]/.test(n)) {
        // Control symbols: \, \; \  \- \' etc.
        const src = s.slice(i, i + 2);
        // "\" at the end of a line is a control space too.
        const sp = n === "," || n === " " || n === "\n" || n === "\t";
        atom({ t: "atom", src, kind: sp || n === ";" || n === ":" || n === "!" ? "space" : "cmd", show: sp ? " " : src });
        i += 2;
        continue;
      }
      let j = i + 1;
      while (j < s.length && /[a-zA-Z@]/.test(s[j])) j++;
      const name = s.slice(i + 1, j);
      let star = false;
      if (s[j] === "*") { star = true; j++; }
      if (FORMAT_CMDS.includes(name) && !star && s[j] === "{") {
        const e = groupEnd(s, j);
        if (e > 0) {
          flush();
          out.push({ t: "fmt", cmd: name, kids: tokenize(s.slice(j + 1, e - 1), look, base + j + 1), at: base + i, end: base + e });
          i = e;
          continue;
        }
      }
      if (CITE.test(name)) {
        const a = args(s, j, 1);
        const keys = (a.braces[0] ?? "").split(",").map((k) => k.trim()).filter(Boolean);
        const nums = keys.map((k) => look.cites?.get(k) ?? "?");
        atom({ t: "atom", src: s.slice(i, a.end), kind: "cite", show: compress(nums) });
        i = a.end;
        continue;
      }
      if (REF.test(name)) {
        const a = args(s, j, 1);
        const keys = (a.braces[0] ?? "").split(",").map((k) => k.trim());
        const v = keys.map((k) => look.labels?.get(k) ?? "??").join(", ");
        atom({ t: "atom", src: s.slice(i, a.end), kind: "ref", show: name === "eqref" ? `(${v})` : refText(name, keys, v, look) });
        i = a.end;
        continue;
      }
      if ((name === "footnote" || name === "bibnote" || name === "thanks") && s[j] === "{") {
        // A note mark where LaTeX puts one; the text is in the source.
        const e = groupEnd(s, j);
        if (e > 0) { atom({ t: "atom", src: s.slice(i, e), kind: "cmd", show: "\u2020" }); i = e; continue; }
      }
      if ((name === "ce" || name === "pu" || name === "ch") && s[j] === "{") {
        // mhchem in text: drawn by KaTeX's mhchem like in math.
        const e = groupEnd(s, j);
        if (e > 0) {
          atom({ t: "atom", src: s.slice(i, e), kind: "math", tex: `\\${name === "ch" ? "ce" : name}{${s.slice(j + 1, e - 1)}}` });
          i = e;
          continue;
        }
      }
      if (CMPD.test(name)) {
        const a = args(s, j, 1);
        const key = (a.braces[0] ?? "").trim();
        atom({ t: "atom", src: s.slice(i, a.end), kind: "cmpd", show: look.labels?.get(key) ?? key });
        i = a.end;
        continue;
      }
      const sym = look.symbols?.[name];
      if (sym !== undefined && s[j] !== "{") {
        // A symbol command eats the spaces after it in TeX; keep them in the atom.
        let e = j;
        if (s[e] === "{" && s[e + 1] === "}") e += 2;
        atom({ t: "atom", src: s.slice(i, e), kind: "cmd", show: sym });
        i = e;
        continue;
      }
      const a = args(s, j, 4);
      atom({ t: "atom", src: s.slice(i, a.end), kind: "cmd", show: s.slice(i, a.end) });
      i = a.end;
      continue;
    }
    if (c === "$") {
      const dbl = s[i + 1] === "$";
      const close = dbl ? findUnescaped(s, "$$", i + 2) : findUnescaped(s, "$", i + 1);
      if (close >= 0) {
        const end = close + (dbl ? 2 : 1);
        atom({ t: "atom", src: s.slice(i, end), kind: "math", tex: (dbl ? "\\displaystyle " : "") + s.slice(i + (dbl ? 2 : 1), close) });
        i = end;
        continue;
      }
      atom({ t: "atom", src: "$", kind: "cmd", show: "$" });
      i++;
      continue;
    }
    if (c === "%") {
      let e = s.indexOf("\n", i);
      if (e < 0) e = s.length;
      atom({ t: "atom", src: s.slice(i, e), kind: "comment", show: s.slice(i, e) });
      i = e;
      continue;
    }
    if (c === "~") { atom({ t: "atom", src: "~", kind: "space", show: " " }); i++; continue; }
    // TeX ligatures: dashes and curly quotes look as in the PDF; the source keeps its hyphens.
    const lig = s.startsWith("---", i) ? "---" : s.startsWith("--", i) ? "--" : s.startsWith("``", i) ? "``" : s.startsWith("''", i) ? "''" : "";
    if (lig) { atom({ t: "atom", src: lig, kind: "space", show: LIGATURES[lig] }); i += lig.length; continue; }
    if (c === "{") {
      const e = groupEnd(s, i);
      if (e > 0) { atom({ t: "atom", src: s.slice(i, e), kind: "cmd", show: s.slice(i, e) }); i = e; continue; }
    }
    if ("^_&#}{".includes(c)) { atom({ t: "atom", src: c, kind: "cmd", show: c }); i++; continue; }
    if (!text) textAt = i;
    text += c;
    i++;
  }
  flush();
  return out;
}

function findUnescaped(s: string, needle: string, from: number): number {
  for (let k = from; k < s.length; k++) {
    if (s[k] === "\\") { k++; continue; }
    if (s.startsWith(needle, k)) return k;
  }
  return -1;
}

/** 1,2,3,5 -> 1–3,5 */
export function compress(nums: string[]): string {
  const out: string[] = [];
  for (let k = 0; k < nums.length; ) {
    let e = k;
    while (e + 1 < nums.length && /^\d+$/.test(nums[e]) && Number(nums[e + 1]) === Number(nums[e]) + 1) e++;
    out.push(e - k >= 2 ? `${nums[k]}–${nums[e]}` : e > k ? `${nums[k]},${nums[e]}` : nums[k]);
    k = e + 1;
  }
  return out.join(",");
}

/** Escape text the user typed. */
const PREFIX_KINDS: Record<string, string> = { fig: "figure", tab: "table", eq: "equation", sec: "section", ssec: "subsection", chap: "chapter", sch: "scheme", app: "appendix", thm: "theorem", lem: "lemma", def: "definition" };
// cleveref's own names: \cref "fig. 1", \Cref "Figure 1"; \autoref is hyperref's "Figure 1".
const SHORT: Record<string, string> = { figure: "fig.", table: "tab.", equation: "eq.", section: "section", subsection: "section", subsubsection: "section", chapter: "chapter", scheme: "scheme", chart: "chart", appendix: "appendix" };
const LONG: Record<string, string> = { figure: "Figure", table: "Table", equation: "Equation", section: "Section", subsection: "Section", subsubsection: "Section", chapter: "Chapter", scheme: "Scheme", chart: "Chart", appendix: "Appendix" };

/** The kind of a label: from the document, else from its prefix (fig:, eq:…). */
export function labelKind(key: string, look: Lookup): string | undefined {
  return look.kinds?.get(key) ?? PREFIX_KINDS[/^([a-zA-Z]+)[:\-_]/.exec(key)?.[1] ?? ""];
}

/** What \ref, \cref, \Cref or \autoref prints. */
function refText(name: string, keys: string[], v: string, look: Lookup): string {
  if (name !== "cref" && name !== "Cref" && name !== "autoref") return v;
  const kind = labelKind(keys[0], look);
  if (!kind) return v;
  const cap = (w: string) => w[0].toUpperCase() + w.slice(1);
  const word = name === "cref" ? SHORT[kind] ?? kind : LONG[kind] ?? cap(kind);
  const num = kind === "equation" && name !== "autoref" ? `(${v})` : v;
  return `${word} ${num}`;
}

export function escapeText(s: string): string {
  let r = "";
  for (const c of s) {
    if (c === " ") r += " ";
    else if (c === " ") r += "\n\n";
    else if (ESCAPABLE.includes(c)) r += "\\" + c;
    else if (c === "\\") r += "\\textbackslash{}";
    else if (c === "^") r += "\\^{}";
    else if (c === "~") r += "\\textasciitilde{}";
    else r += c;
  }
  return r;
}

export function serialize(nodes: Inline[]): string {
  let r = "";
  for (const n of nodes) {
    if (n.t === "text") r += escapeText(n.s);
    else if (n.t === "fmt") r += `\\${n.cmd}{${serialize(n.kids)}}`;
    else r += n.src;
  }
  return r;
}
