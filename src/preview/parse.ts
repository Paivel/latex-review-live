import { MATH_SYMBOLS, TEXT_SYMBOLS, UNITS, toSub, toSup } from "./symbols";

export type Style =
  | "bold"
  | "italic"
  | "underline"
  | "code"
  | "smallcaps"
  | "heading1"
  | "heading2"
  | "heading3"
  | "math"
  | "ref"
  | "muted"
  | "note"
  | "link";

/**
 * One instruction for live preview. A piece with hide or text conceals
 * start..end (showing text instead, if given); a piece with only style
 * styles visible text. owner is the LaTeX element the piece belongs to:
 * with the cursor in it the element's code is shown.
 */
export interface Piece {
  start: number;
  end: number;
  hide?: boolean;
  text?: string;
  textStyle?: Style;
  style?: Style;
  owner: [number, number];
}

export interface Refs {
  /** \label key → number as typeset. */
  labels: Map<string, string>;
  /** \cite key → number or label as typeset. */
  cites: Map<string, string>;
}

export const noRefs = (): Refs => ({ labels: new Map(), cites: new Map() });

const STYLE_CMDS: Record<string, Style | null> = {
  textbf: "bold",
  textit: "italic",
  emph: "italic",
  textsl: "italic",
  underline: "underline",
  uline: "underline",
  texttt: "code",
  textsc: "smallcaps",
  textrm: null,
  textsf: null,
  textup: null,
  textmd: null,
  textnormal: null,
  mbox: null,
  text: null,
};

const SECTIONS: Record<string, Style> = {
  part: "heading1",
  chapter: "heading1",
  section: "heading1",
  subsection: "heading2",
  subsubsection: "heading3",
  paragraph: "heading3",
  subparagraph: "heading3",
  title: "heading1",
};

const CITE = /^(cite|citep|citet|citealp|citealt|citeauthor|citeyear|citeyearpar|parencite|textcite|autocite|footcite|supercite|smartcite|Cite|Citep|Citet|Parencite|Textcite|Autocite|Smartcite)$/;
const REFS = /^(ref|eqref|autoref|cref|Cref|crefrange|pageref|vref|nameref|subref|cpageref)$/;
const QUIET = /^(centering|raggedright|raggedleft|noindent|indent|maketitle|clearpage|newpage|cleardoublepage|tableofcontents|listoffigures|listoftables|bigskip|medskip|smallskip|vfill|hfill|par|linebreak|pagebreak|nopagebreak|protect|appendix|frontmatter|mainmatter|backmatter|tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge|bfseries|itshape|mdseries|upshape|rmfamily|sffamily|ttfamily|printbibliography|bibliography|bibliographystyle|vspace|hspace|addvspace|setlength|addcontentsline|phantom|hphantom|vphantom|FloatBarrier|ce@|label)$/;
const MATH_ENVS = /^(equation|align|gather|multline|flalign|alignat|eqnarray|math|displaymath|split)\*?$/;
const FLOATS: Record<string, string> = { figure: "Figure", "figure*": "Figure", table: "Table", "table*": "Table", scheme: "Scheme", "scheme*": "Scheme", chart: "Chart", graph: "Graph" };
const QUIET_ENVS = /^(document|center|flushleft|flushright|quote|quotation|verse|minipage|small|footnotesize|landscape)$/;
const LISTS = /^(itemize|enumerate|description|compactitem|compactenum|inparaenum|asparaenum)$/;
const ACCENTS: Record<string, string> = {
  "'": "́", "`": "̀", "^": "̂", '"': "̈", "~": "̃", "=": "̄", ".": "̇",
  u: "̆", v: "̌", H: "̋", c: "̧", k: "̨", r: "̊", d: "̣", b: "̱",
};

const isLetter = (ch: string | undefined) => !!ch && /[a-zA-Z@]/.test(ch);

export function parseLatex(text: string, refs: Refs = noRefs()): Piece[] {
  return new Parser(text, refs).run();
}

class Parser {
  out: Piece[] = [];
  lists: { kind: string; n: number }[] = [];
  constructor(
    private t: string,
    private refs: Refs,
  ) {}

  run(): Piece[] {
    const begin = /\\begin\s*\{document\}/.exec(this.t);
    let from = 0;
    if (begin) {
      // Preamble: show its title, nothing else.
      from = begin.index;
    }
    this.text(from, this.t.length);
    this.out.sort((a, b) => a.start - b.start || a.end - b.end);
    return this.out;
  }

  // ---------------------------------------------------------------- helpers

  private hide(start: number, end: number, owner: [number, number]) {
    if (end > start) this.out.push({ start, end, hide: true, owner });
  }
  private replace(start: number, end: number, text: string, owner: [number, number], textStyle?: Style) {
    this.out.push({ start, end, hide: true, text, owner, ...(textStyle ? { textStyle } : {}) });
  }
  private style(start: number, end: number, style: Style, owner: [number, number]) {
    if (end > start) this.out.push({ start, end, style, owner });
  }

  /** After a command name: its end. */
  private nameEnd(i: number): number {
    let j = i;
    if (isLetter(this.t[j])) {
      while (isLetter(this.t[j])) j++;
      return j;
    }
    return j + 1;
  }

  private skipSpace(i: number): number {
    while (i < this.t.length && (this.t[i] === " " || this.t[i] === "\t")) i++;
    return i;
  }

  /** A {group} at i (after optional blanks): index after its closing brace. */
  private group(i: number): { open: number; close: number; end: number } | undefined {
    const j = this.skipSpace(i);
    if (this.t[j] !== "{") return undefined;
    let depth = 0;
    for (let k = j; k < this.t.length; k++) {
      const ch = this.t[k];
      if (ch === "\\") {
        k++;
        continue;
      }
      if (ch === "%") {
        while (k < this.t.length && this.t[k] !== "\n") k++;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return { open: j, close: k, end: k + 1 };
      }
    }
    return undefined;
  }

  /** An [optional] argument at i: index after ']'. */
  private optional(i: number): { open: number; close: number; end: number } | undefined {
    const j = this.skipSpace(i);
    if (this.t[j] !== "[") return undefined;
    let depth = 0;
    for (let k = j + 1; k < this.t.length; k++) {
      const ch = this.t[k];
      if (ch === "\\") {
        k++;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === "]" && depth === 0) return { open: j, close: k, end: k + 1 };
      else if (ch === "\n" && this.t[k + 1] === "\n") return undefined;
    }
    return undefined;
  }

  private inner(g: { open: number; close: number }) {
    return this.t.slice(g.open + 1, g.close);
  }

  /** Start of the text after a math delimiter, or of an \end{env}. */
  private findEnd(env: string, from: number): number {
    const re = new RegExp("\\\\end\\s*\\{" + env.replace(/[*]/g, "\\*") + "\\}", "g");
    re.lastIndex = from;
    const m = re.exec(this.t);
    return m ? m.index : -1;
  }

  // ---------------------------------------------------------------- text mode

  private text(from: number, to: number) {
    let i = from;
    const t = this.t;
    while (i < to) {
      const ch = t[i];
      if (ch === "%") {
        let e = i;
        while (e < to && t[e] !== "\n") e++;
        this.style(i, e, "muted", [i, e]);
        i = e;
      } else if (ch === "\\") {
        i = this.command(i, to);
      } else if (ch === "$") {
        i = this.dollar(i, to);
      } else if (ch === "~") {
        this.replace(i, i + 1, " ", [i, i + 1]);
        i++;
      } else if (ch === "-" && t[i + 1] === "-") {
        const n = t[i + 2] === "-" ? 3 : 2;
        this.replace(i, i + n, n === 3 ? "—" : "–", [i, i + n]);
        i += n;
      } else if (ch === "`") {
        const n = t[i + 1] === "`" ? 2 : 1;
        this.replace(i, i + n, n === 2 ? "“" : "‘", [i, i + n]);
        i += n;
      } else if (ch === "'" && t[i + 1] === "'") {
        this.replace(i, i + 2, "”", [i, i + 2]);
        i += 2;
      } else {
        i++;
      }
    }
  }

  private dollar(i: number, to: number): number {
    const t = this.t;
    const display = t[i + 1] === "$";
    const d = display ? 2 : 1;
    let k = i + d;
    for (; k < to; k++) {
      if (t[k] === "\\") {
        k++;
        continue;
      }
      if (t[k] === "$") break;
      if (!display && t[k] === "\n" && t[k + 1] === "\n") return i + 1;
    }
    if (k >= to) return i + 1;
    const end = k + d;
    const owner: [number, number] = [i, end];
    this.hide(i, i + d, owner);
    this.hide(k, end, owner);
    this.style(i + d, k, "math", owner);
    this.math(i + d, k, owner);
    return end;
  }

  private command(i: number, to: number): number {
    const t = this.t;
    const ne = this.nameEnd(i + 1);
    const name = t.slice(i + 1, ne);
    let after = ne;
    const star = t[after] === "*";

    // \\ line break
    if (name === "\\") {
      let e = ne;
      const o = this.optional(e);
      if (o) e = o.end;
      this.replace(i, e, " ↵", [i, e], "muted");
      return e;
    }
    // \( … \) and \[ … \]
    if (name === "(" || name === "[") {
      const close = name === "(" ? "\\)" : "\\]";
      const k = t.indexOf(close, ne);
      if (k < 0 || k > to) return ne;
      const owner: [number, number] = [i, k + 2];
      this.hide(i, ne, owner);
      this.hide(k, k + 2, owner);
      this.style(ne, k, "math", owner);
      this.math(ne, k, owner);
      return k + 2;
    }
    // Accents: \'e, \"{o}, \c{c}
    if (ACCENTS[name] !== undefined && (name.length === 1 && !isLetter(name) ? true : !isLetter(t[ne]))) {
      const g = this.group(ne);
      let base: string | undefined;
      let e = ne;
      if (g && g.close - g.open <= 3) {
        base = this.inner(g).replace(/^\\/, "");
        e = g.end;
      } else if (!isLetter(name) && /[a-zA-Z]/.test(t[ne] ?? "")) {
        base = t[ne];
        e = ne + 1;
      } else if (isLetter(name) && t[ne] === " " && /[a-zA-Z]/.test(t[ne + 1] ?? "")) {
        base = t[ne + 1];
        e = ne + 2;
      }
      if (base && base.length === 1) {
        const ch = base === "i" ? "ı" : base;
        this.replace(i, e, (ch + ACCENTS[name]).normalize("NFC"), [i, e]);
        return e;
      }
    }

    if (star) after++;

    if (name in STYLE_CMDS) {
      const g = this.group(after);
      if (!g) return ne;
      const owner: [number, number] = [i, g.end];
      this.hide(i, g.open + 1, owner);
      this.hide(g.close, g.end, owner);
      const s = STYLE_CMDS[name];
      if (s) this.style(g.open + 1, g.close, s, owner);
      this.text(g.open + 1, g.close);
      return g.end;
    }

    if (name in SECTIONS) {
      let e = after;
      const o = this.optional(e);
      if (o) e = o.end;
      const g = this.group(e);
      if (!g) return ne;
      const owner: [number, number] = [i, g.end];
      this.hide(i, g.open + 1, owner);
      this.hide(g.close, g.end, owner);
      this.style(g.open + 1, g.close, SECTIONS[name], owner);
      this.text(g.open + 1, g.close);
      return g.end;
    }

    if (CITE.test(name)) {
      let e = after;
      for (let n = 0; n < 2; n++) {
        const o = this.optional(e);
        if (o) e = o.end;
      }
      const g = this.group(e);
      if (!g) return ne;
      const keys = this.inner(g).split(",").map((k) => k.trim()).filter(Boolean);
      const shown = keys.map((k) => this.refs.cites.get(k) ?? k);
      this.replace(i, g.end, `[${compressNumbers(shown).join(", ")}]`, [i, g.end], "ref");
      return g.end;
    }
    if (name === "nocite") {
      const g = this.group(after);
      if (!g) return ne;
      this.hide(i, g.end, [i, g.end]);
      return g.end;
    }

    if (REFS.test(name)) {
      const g = this.group(after);
      if (!g) return ne;
      const keys = this.inner(g).split(",").map((k) => k.trim()).filter(Boolean);
      const shown = keys.map((k) => {
        const n = this.refs.labels.get(k) ?? "??";
        if (name === "eqref") return `(${n})`;
        if (name === "autoref" || name === "cref" || name === "Cref") return refName(k, name === "Cref") + n;
        return n;
      });
      this.replace(i, g.end, shown.join(", "), [i, g.end], "ref");
      return g.end;
    }

    if (name === "label") {
      const g = this.group(after);
      if (!g) return ne;
      this.hide(i, g.end, [i, g.end]);
      return g.end;
    }

    if (name === "footnote" || name === "footnotetext" || name === "marginpar" || name === "todo") {
      let e = after;
      const o = this.optional(e);
      if (o) e = o.end;
      const g = this.group(e);
      if (!g) return ne;
      const owner: [number, number] = [i, g.end];
      this.replace(i, g.open + 1, name === "todo" ? " [todo: " : " [", owner, "note");
      this.replace(g.close, g.end, "]", owner, "note");
      this.style(g.open + 1, g.close, "note", owner);
      this.text(g.open + 1, g.close);
      return g.end;
    }

    if (name === "item") {
      let e = after;
      const o = this.optional(e);
      const list = this.lists[this.lists.length - 1];
      let bullet = "•";
      if (o) {
        bullet = this.inner({ open: o.open, close: o.close });
        e = o.end;
      } else if (list && /enum/.test(list.kind)) {
        bullet = `${++list.n}.`;
      }
      if (t[e] === " ") e++;
      this.replace(i, e, bullet + " ", [i, e], o ? "bold" : undefined);
      return e;
    }

    if (name === "begin" || name === "end") return this.environment(i, name, after, to);

    if (name === "includegraphics") {
      let e = after;
      const o = this.optional(e);
      if (o) e = o.end;
      const g = this.group(e);
      if (!g) return ne;
      this.replace(i, g.end, `🖼 ${this.inner(g)}`, [i, g.end], "muted");
      return g.end;
    }

    if (name === "caption") {
      let e = after;
      const o = this.optional(e);
      if (o) e = o.end;
      const g = this.group(e);
      if (!g) return ne;
      const owner: [number, number] = [i, g.end];
      this.replace(i, g.open + 1, "Caption: ", owner, "muted");
      this.hide(g.close, g.end, owner);
      this.style(g.open + 1, g.close, "italic", owner);
      this.text(g.open + 1, g.close);
      return g.end;
    }

    if (name === "href") {
      const u = this.group(after);
      const g = u && this.group(u.end);
      if (!u || !g) return ne;
      const owner: [number, number] = [i, g.end];
      this.hide(i, g.open + 1, owner);
      this.hide(g.close, g.end, owner);
      this.style(g.open + 1, g.close, "link", owner);
      this.text(g.open + 1, g.close);
      return g.end;
    }
    if (name === "url" || name === "doi") {
      const g = this.group(after);
      if (!g) return ne;
      const owner: [number, number] = [i, g.end];
      this.hide(i, g.open + 1, owner);
      this.hide(g.close, g.end, owner);
      this.style(g.open + 1, g.close, "link", owner);
      return g.end;
    }

    if (name === "ce" || name === "chemfig" || name === "chemformula") {
      const g = this.group(after);
      if (!g || name === "chemfig") return ne;
      this.replace(i, g.end, formatCe(this.inner(g)), [i, g.end]);
      return g.end;
    }

    if (name === "SI" || name === "qty") {
      let e = after;
      const o = this.optional(e);
      if (o) e = o.end;
      const n = this.group(e);
      const u = n && this.group(n.end);
      if (!n || !u) return ne;
      this.replace(i, u.end, `${formatNum(this.inner(n))} ${formatUnit(this.inner(u))}`, [i, u.end]);
      return u.end;
    }
    if (name === "si" || name === "unit" || name === "num" || name === "ang") {
      let e = after;
      const o = this.optional(e);
      if (o) e = o.end;
      const g = this.group(e);
      if (!g) return ne;
      const v = this.inner(g);
      this.replace(i, g.end, name === "num" ? formatNum(v) : name === "ang" ? `${v}°` : formatUnit(v), [i, g.end]);
      return g.end;
    }
    if (name === "SIrange" || name === "qtyrange") {
      const a = this.group(after);
      const b = a && this.group(a.end);
      const u = b && this.group(b.end);
      if (!a || !b || !u) return ne;
      this.replace(i, u.end, `${formatNum(this.inner(a))}–${formatNum(this.inner(b))} ${formatUnit(this.inner(u))}`, [i, u.end]);
      return u.end;
    }

    if (name === "cmpd" || name === "refcmpd" || name === "cmpdref") {
      let e = after;
      const o = this.optional(e);
      if (o) e = o.end;
      const g = this.group(e);
      if (!g) return ne;
      const keys = this.inner(g).split(",").map((k) => k.trim()).filter(Boolean);
      this.replace(i, g.end, keys.map((k) => this.refs.labels.get("cmpd:" + k) ?? k).join(", "), [i, g.end], "bold");
      return g.end;
    }

    if (name === "textsuperscript" || name === "textsubscript") {
      const g = this.group(after);
      if (!g) return ne;
      const v = this.inner(g);
      const s = name === "textsuperscript" ? toSup(v) : toSub(v);
      if (s !== undefined) this.replace(i, g.end, s, [i, g.end]);
      return g.end;
    }

    if (name === "author" || name === "date") {
      const g = this.group(after);
      if (!g) return ne;
      const owner: [number, number] = [i, g.end];
      this.hide(i, g.open + 1, owner);
      this.hide(g.close, g.end, owner);
      this.style(g.open + 1, g.close, "italic", owner);
      this.text(g.open + 1, g.close);
      return g.end;
    }

    if (name in TEXT_SYMBOLS && !(name.length === 1 && isLetter(name) && isLetter(t[ne]))) {
      let e = ne;
      if (isLetter(name[0]) && t.startsWith("{}", e)) e += 2;
      this.replace(i, e, TEXT_SYMBOLS[name], [i, e]);
      return e;
    }

    if (QUIET.test(name)) {
      let e = after;
      if (/^(vspace|hspace|addvspace|bibliography|bibliographystyle|phantom|hphantom|vphantom)$/.test(name)) {
        const g = this.group(e);
        if (g) e = g.end;
      }
      this.style(i, e, "muted", [i, e]);
      return e;
    }

    return ne;
  }

  private environment(i: number, kind: "begin" | "end", after: number, to: number): number {
    const g = this.group(after);
    if (!g) return after;
    const env = this.inner(g).trim();
    const owner: [number, number] = [i, g.end];

    if (kind === "begin" && MATH_ENVS.test(env)) {
      const k = this.findEnd(env, g.end);
      if (k < 0) return g.end;
      const endG = this.group(k + 4);
      const stop = endG ? endG.end : k;
      const all: [number, number] = [i, stop];
      this.style(i, g.end, "muted", all);
      this.style(k, stop, "muted", all);
      this.style(g.end, k, "math", all);
      this.math(g.end, k, all);
      return stop;
    }

    if (LISTS.test(env)) {
      if (kind === "begin") this.lists.push({ kind: env, n: 0 });
      else this.lists.pop();
      let e = g.end;
      if (kind === "begin") {
        const o = this.optional(e);
        if (o) e = o.end;
      }
      this.hide(i, e, [i, e]);
      return e;
    }

    if (env in FLOATS) {
      let e = g.end;
      if (kind === "begin") {
        const o = this.optional(e);
        if (o) e = o.end;
        this.replace(i, e, `▣ ${FLOATS[env]}`, [i, e], "muted");
      } else {
        this.hide(i, e, [i, e]);
      }
      return e;
    }

    if (env === "abstract") {
      if (kind === "begin") this.replace(i, g.end, "Abstract", owner, "heading2");
      else this.hide(i, g.end, owner);
      return g.end;
    }

    if (QUIET_ENVS.test(env)) {
      this.hide(i, g.end, owner);
      return g.end;
    }

    if (env === "verbatim" || env === "lstlisting" || env === "minted" || env === "comment") {
      if (kind !== "begin") return g.end;
      const k = this.findEnd(env, g.end);
      if (k < 0) return g.end;
      const endG = this.group(k + 4);
      const stop = endG ? endG.end : k;
      this.style(g.end, k, env === "comment" ? "muted" : "code", [i, stop]);
      return stop;
    }

    this.style(i, g.end, "muted", owner);
    return g.end;
  }

  // ---------------------------------------------------------------- math mode

  private math(from: number, to: number, owner: [number, number]) {
    const t = this.t;
    let i = from;
    while (i < to) {
      const ch = t[i];
      if (ch === "%") {
        while (i < to && t[i] !== "\n") i++;
        continue;
      }
      if (ch === "^" || ch === "_") {
        i = this.script(i, to, owner);
        continue;
      }
      if (ch !== "\\") {
        i++;
        continue;
      }
      const ne = this.nameEnd(i + 1);
      const name = t.slice(i + 1, ne);
      if (name in MATH_SYMBOLS) {
        this.replace(i, ne, MATH_SYMBOLS[name], owner);
        i = ne;
        continue;
      }
      if (/^(mathrm|text|textrm|operatorname|mathit|mathsf|mathcal|mathbb|mathbf|boldsymbol|bm|mbox|textbf|textit|mathnormal|mathup)$/.test(name)) {
        const g = this.group(ne);
        if (!g) {
          i = ne;
          continue;
        }
        this.hide(i, g.open + 1, owner);
        this.hide(g.close, g.end, owner);
        if (/bf|bold|bm/.test(name)) this.style(g.open + 1, g.close, "bold", owner);
        if (name === "mathbb" || name === "mathcal") {
          const v = this.inner(g);
          const m = (name === "mathbb" ? BB : CAL)[v];
          if (m) {
            this.replace(i, g.end, m, owner);
            i = g.end;
            continue;
          }
        }
        this.math(g.open + 1, g.close, owner);
        i = g.end;
        continue;
      }
      if (/^(frac|dfrac|tfrac|cfrac)$/.test(name)) {
        const a = this.group(ne);
        const b = a && this.group(a.end);
        if (!a || !b) {
          i = ne;
          continue;
        }
        const simple = (s: string) => /^[\w.]+$/.test(s) || /^\\[a-zA-Z]+$/.test(s);
        const pa = !simple(this.inner(a));
        const pb = !simple(this.inner(b));
        this.replace(i, a.open + 1, pa ? "(" : "", owner);
        this.replace(a.close, b.open + 1, `${pa ? ")" : ""}/${pb ? "(" : ""}`, owner);
        this.replace(b.close, b.end, pb ? ")" : "", owner);
        this.math(a.open + 1, a.close, owner);
        this.math(b.open + 1, b.close, owner);
        i = b.end;
        continue;
      }
      if (name === "sqrt") {
        let e = ne;
        const o = this.optional(e);
        let root = "√";
        if (o) {
          const s = toSup(this.inner(o));
          if (s) root = s + "√";
          e = o.end;
        }
        const g = this.group(e);
        if (!g) {
          i = ne;
          continue;
        }
        const simple = /^[\w.]+$/.test(this.inner(g));
        this.replace(i, g.open + 1, simple ? root : root + "(", owner);
        this.replace(g.close, g.end, simple ? "" : ")", owner);
        this.math(g.open + 1, g.close, owner);
        i = g.end;
        continue;
      }
      if (/^(left|right|big|Big|bigg|Bigg|bigl|bigr|Bigl|Bigr|biggl|biggr|middle|displaystyle|textstyle|limits|nolimits|nonumber|notag)$/.test(name)) {
        let e = ne;
        if (/^(left|right)$/.test(name) && t[e] === ".") e++;
        this.hide(i, e, owner);
        i = e;
        continue;
      }
      if (name === "ce") {
        const g = this.group(ne);
        if (g) {
          this.replace(i, g.end, formatCe(this.inner(g)), owner);
          i = g.end;
          continue;
        }
      }
      if (name === "label") {
        const g = this.group(ne);
        if (g) {
          this.hide(i, g.end, owner);
          i = g.end;
          continue;
        }
      }
      if (name === "\\") {
        this.style(i, ne, "muted", owner);
      }
      i = ne;
    }
  }

  /** ^x, _{xy}: Unicode super/subscript when every character has one. */
  private script(i: number, to: number, owner: [number, number]): number {
    const t = this.t;
    const sup = t[i] === "^";
    const g = this.group(i + 1);
    let body: string;
    let end: number;
    if (g && g.end <= to) {
      body = this.inner(g).trim();
      end = g.end;
    } else if (t[i + 1] === "\\") {
      const ne = this.nameEnd(i + 2);
      body = t.slice(i + 1, ne);
      end = ne;
    } else {
      body = t[i + 1] ?? "";
      end = i + 2;
    }
    if (sup && (body === "\\circ" || body === "\\degree" || body === "o")) {
      this.replace(i, end, "°", owner);
      return end;
    }
    if (sup && /^\\prime$|^'$/.test(body)) {
      this.replace(i, end, "′", owner);
      return end;
    }
    const plain = body.replace(/\\[a-zA-Z]+/g, (m) => MATH_SYMBOLS[m.slice(1)] ?? m).replace(/\s+/g, "");
    const s = sup ? toSup(plain) : toSub(plain);
    if (s !== undefined && s !== "") {
      this.replace(i, end, s, owner);
      return end;
    }
    if (g) {
      this.math(g.open + 1, g.close, owner);
      return g.end;
    }
    return i + 1;
  }
}

const BB: Record<string, string> = { R: "ℝ", N: "ℕ", Z: "ℤ", Q: "ℚ", C: "ℂ", P: "ℙ", E: "𝔼" };
const CAL: Record<string, string> = { L: "ℒ", H: "ℋ", O: "𝒪", F: "ℱ", E: "ℰ", B: "ℬ", M: "ℳ", R: "ℛ", I: "ℐ" };

function refName(key: string, cap: boolean): string {
  const p = key.split(":")[0].toLowerCase();
  const names: Record<string, string> = {
    fig: "fig.", figure: "fig.", tab: "table", table: "table", eq: "eq.", eqn: "eq.", sec: "section", section: "section",
    ch: "chapter", chap: "chapter", app: "appendix", scheme: "scheme", sch: "scheme", lst: "listing", alg: "algorithm",
  };
  const n = names[p];
  if (!n) return "";
  return (cap ? n[0].toUpperCase() + n.slice(1) : n) + " ";
}

/** [1, 2, 3, 5] → ["1–3", "5"]; leaves anything that is not a number alone. */
export function compressNumbers(xs: string[]): string[] {
  if (!xs.every((x) => /^\d+$/.test(x))) return xs;
  const ns = [...new Set(xs.map(Number))].sort((a, b) => a - b);
  const out: string[] = [];
  for (let k = 0; k < ns.length; ) {
    let j = k;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    out.push(j - k >= 2 ? `${ns[k]}–${ns[j]}` : j > k ? `${ns[k]}, ${ns[j]}` : `${ns[k]}`);
    k = j + 1;
  }
  return out;
}

/** mhchem, the common cases: H2O → H₂O, SO4^2- → SO₄²⁻, A + B -> C. */
export function formatCe(s: string): string {
  let v = s
    .replace(/<=>>?|<<?=>/g, "⇌")
    .replace(/<->/g, "↔")
    .replace(/->/g, "→")
    .replace(/<-/g, "←")
    .replace(/\\(\w+)/g, (m, n) => MATH_SYMBOLS[n] ?? TEXT_SYMBOLS[n] ?? m);
  // Charges: ^{2+}, ^2-, ^+, ^-
  v = v.replace(/\^\{([^}]*)\}|\^([0-9]*[+\-]|[0-9]+)/g, (m, a, b) => toSup((a ?? b).replace(/\s/g, "")) ?? m);
  // Bare trailing charge after an element or ) like Fe3+ is left as written; digits after an element, ) or ] are subscripts.
  v = v.replace(/([A-Za-z)\]])(\d+)/g, (_m, a, d) => a + (toSub(d) ?? d));
  v = v.replace(/_\{([^}]*)\}|_(\d+)/g, (m, a, b) => toSub(a ?? b) ?? m);
  return v.replace(/[{}]/g, "");
}

/** siunitx numbers: 1.5e-3 → 1.5×10⁻³, 10+-2 → 10 ± 2. */
export function formatNum(s: string): string {
  let v = s.trim().replace(/\s*\+-\s*/g, " ± ").replace(/\\pm/g, "±");
  v = v.replace(/^([-+]?[\d.,]*)\s*[eE]\s*([-+]?\d+)$/, (_m, a, e) => `${a ? a + "×" : ""}10${toSup(e.replace(/^\+/, "")) ?? "^" + e}`);
  return v.replace(/(\d)-(?=\d)/g, "$1−").replace(/^-/, "−");
}

/** siunitx units: \milli\gram\per\milli\litre → mg/mL; mg.mL^-1 → mg·mL⁻¹. */
export function formatUnit(s: string): string {
  const v = s.trim();
  if (!v.includes("\\")) {
    return v
      .replace(/\^\{?(-?\d+)\}?/g, (m, e) => toSup(e) ?? m)
      .replace(/\s*[.~]\s*/g, "·")
      .replace(/\bu(?=[A-Za-z])/g, "µ");
  }
  const parts: string[] = [];
  let pendingPow = "";
  let per = false;
  let cur = "";
  let curIsPrefix = false;
  const flush = () => {
    curIsPrefix = false;
    if (cur) {
      parts.push((per ? "/" : parts.length ? "·" : "") + cur + pendingPow);
      cur = "";
      pendingPow = "";
      per = false;
    }
  };
  const tokens = v.match(/\\[a-zA-Z]+|\{[^}]*\}|[^\\\s{}]+/g) ?? [];
  let nextPow = "";
  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k];
    if (!tok.startsWith("\\")) {
      if (cur) flush();
      cur = tok.replace(/[{}]/g, "");
      continue;
    }
    const n = tok.slice(1);
    if (n === "per") {
      flush();
      per = true;
      continue;
    }
    if (n === "square") {
      nextPow = "²";
      continue;
    }
    if (n === "cubic") {
      nextPow = "³";
      continue;
    }
    if (n === "squared" || n === "cubed") {
      pendingPow = n === "squared" ? "²" : "³";
      continue;
    }
    if (n === "tothe") {
      const arg = tokens[k + 1]?.replace(/[{}]/g, "") ?? "";
      pendingPow = toSup(arg) ?? "^" + arg;
      k++;
      continue;
    }
    const u = UNITS[n];
    if (u === undefined) {
      cur += n;
      continue;
    }
    const isPrefix = /^(kilo|mega|giga|milli|micro|nano|pico|femto|centi|deci)$/.test(n);
    if (isPrefix) {
      if (cur) flush();
      cur = u;
      curIsPrefix = true;
      continue;
    }
    if (curIsPrefix) {
      cur += u;
      curIsPrefix = false;
    }
    else {
      if (cur) flush();
      cur = u;
    }
    if (nextPow) {
      pendingPow = nextPow;
      nextPow = "";
    }
  }
  flush();
  return parts.join("").replace(/^·/, "");
}
