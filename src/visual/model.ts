// What the extension sends to the visual editor page. Pure, so it can be tested.
import { Block, MATH_ENVS, headingNumbers, splitBlocks } from "./blocks";
import { Inline, Lookup, tokenize } from "./inline";
import { preambleMacros } from "./macros";
import { ListInfo, commandArg, commandArgs, envBox, inputPaths, onlyCommands, parseList, theoremEnvs } from "./structure";

/** Inline nodes plus track-changes marks. */
export type MNode =
  | { t: "text"; s: string; at: number; ins?: number }
  | { t: "fmt"; cmd: string; kids: MNode[]; at: number; end: number }
  | { t: "atom"; src: string; at: number; kind: string; show?: string; tex?: string; ins?: number }
  | { t: "del"; s: string; c: number };

export interface Mark {
  curStart: number;
  curEnd: number;
  deleted: string;
}

export interface VImage {
  name: string;
  /** Webview URI of the picture, or null when not found. */
  uri: string | null;
  pdf: boolean;
  /** The picture is still being drawn. */
  pending?: boolean;
  /** Share of the line the picture takes (width=0.6\\linewidth). */
  widthFrac?: number;
  /** Natural size of the picture in pt (PDF MediaBox), shown at that size like \\includegraphics without a width. */
  widthPt?: number;
  heightPt?: number;
  /** Text Reactio Draw sets over the drawing (compound numbers): position as a fraction of the picture, size in pt. */
  labels?: { x: number; y: number; size: number; tex: string; nodes?: MNode[] }[];
  /** The picture PDF's own page size in pt, however it is scaled in the document (to find it on a built page). */
  box?: { w: number; h: number };
  /** Picture file, and the figure's .tex for an \\input figure (for Reactio Draw). */
  file?: string;
  entry?: string;
}

export interface VBlock {
  /** "deleted": text tracked as deleted where no block is now, such as a whole paragraph. */
  kind: Block["kind"] | "deleted";
  start: number;
  end: number;
  src: string;
  /** heading */
  level?: number;
  num?: string;
  title?: { start: number; end: number; nodes: MNode[] };
  /** para */
  nodes?: MNode[];
  /** figure */
  fig?: {
    start: number;
    env: string;
    num: string;
    images: VImage[];
    caption: { start: number; end: number; nodes: MNode[] } | null;
    label: { start: number; end: number; text: string } | null;
  };
  /** math */
  tex?: string;
  /** code block with \\bibliography: the reference list from the last build. */
  bib?: { label: string; nodes: MNode[] }[];
  /** list: its items. */
  list?: VList;
  /** code block with \maketitle: the title, authors and date from the preamble. */
  titleBlock?: {
    title: VText | null;
    authors: VText[];
    /** achemso: "*,‡" after each author. */
    authorMarks: string[];
    date: VText | null;
    affiliations: { text: VText; mark: string }[];
    emails: string[];
    phone?: string;
    fax?: string;
  };
  /** The \begin / \end line of an open environment (abstract, acknowledgement...): drawn as its heading, or not at all. */
  wrap?: { env: string; side: "begin" | "end"; title: string };
  /** The innermost open environment the block sits in. */
  within?: string;
  /** Only comments: drawn folded. */
  commentOnly?: boolean;
  /** Not in the source: a title the class prints on its own (achemso). */
  virtual?: boolean;
  /** theorem-like environment, proof or abstract. */
  envbox?: { title: string; num?: string; note: VText | null; inner: VText };
  /** code block of \input / \include lines: the files, found or not. */
  inputs?: { path: string; file?: string }[];
  /** The block's own source is not shown: what is drawn stands for it. */
  hideSource?: boolean;
  /** Whether a tracked change touches the block. */
  changed?: boolean;
}

/** An editable piece of text: its source range and how it is drawn. */
export interface VText { start: number; end: number; nodes: MNode[]; src?: string }

export interface VList {
  env: string;
  items: { text: VText; label: VText | null; sub: VList[] }[];
}

export interface VDoc {
  uri: string;
  version: number;
  name: string;
  superCites: boolean;
  /** \documentclass name. */
  docClass: string;
  /** Body font size of the document in pt (10, 11 or 12). */
  fontPt: number;
  /** The preamble's own commands, for KaTeX. */
  macros: Record<string, string>;
  tracking: boolean;
  changes: Mark[];
  blocks: VBlock[];
}

/** Split inline nodes at tracked insertions and put deleted text where it was. */
export function markNodes(nodes: Inline[], marks: Mark[], srcLen: (n: Inline) => number, start: number, end: number, done = new Set<number>()): MNode[] {
  const out: MNode[] = [];
  const insAt = (a: number, b: number) => marks.findIndex((m) => m.curEnd > m.curStart && m.curStart < b && a < m.curEnd);
  const dels = (upTo: number) => {
    marks.forEach((m, c) => {
      if (m.deleted && !done.has(c) && m.curStart >= start && m.curStart <= upTo) { done.add(c); out.push({ t: "del", s: m.deleted, c }); }
    });
  };
  for (const n of nodes) {
    const len = srcLen(n);
    const a = n.at, b = n.at + len;
    if (n.t === "fmt") {
      dels(a);
      out.push({ ...n, kids: markNodes(n.kids, marks, srcLen, start, n.end - 1, done) });
      continue;
    }
    if (n.t === "atom" || len !== n.s.length) {
      dels(a);
      const i = insAt(a, b);
      out.push(i >= 0 ? { ...n, ins: i } : { ...n });
      continue;
    }
    // Plain text: cut at every mark boundary inside it.
    const cuts = new Set<number>([a, b]);
    for (const m of marks) for (const p of [m.curStart, m.curEnd]) if (p > a && p < b) cuts.add(p);
    const pts = [...cuts].sort((x, y) => x - y);
    for (let k = 0; k + 1 < pts.length; k++) {
      const s = pts[k], e = pts[k + 1];
      dels(s);
      const i = insAt(s, e);
      const piece: MNode = { t: "text", s: n.s.slice(s - a, e - a), at: s };
      if (i >= 0) (piece as { ins?: number }).ins = i;
      out.push(piece);
    }
  }
  dels(end);
  return out;
}

export interface BuildInput {
  text: string;
  uri: string;
  version: number;
  name: string;
  look: Lookup;
  tracking: boolean;
  marks: Mark[];
  /** Entries of the last build's .bbl. */
  bbl?: { key: string; label: string; tex: string }[];
  /** The file an \input / \include names, if it exists. */
  inputFile?: (path: string) => string | undefined;
  /** Picture resolver for a figure's graphic. */
  images: (fig: NonNullable<Block["figure"]>) => VImage[];
}

export function buildDoc(inp: BuildInput): VDoc {
  const { text, look, marks } = inp;
  const blocks = splitBlocks(text);
  const nums = headingNumbers(blocks);
  const counters: Record<string, number> = {};
  let eq = 0;
  const srcLen = (n: Inline): number => {
    if (n.t === "atom") return n.src.length;
    if (n.t === "fmt") return n.end - n.at;
    // An escaped character is one character shown, two in the source.
    return text[n.at] === "\\" && n.s.length === 1 ? 2 : n.s.length;
  };
  // Deletions drawn inside a block; the others get a block of their own.
  const shown = new Set<number>();
  const pre = blocks[0]?.kind === "preamble" ? text.slice(blocks[0].start, blocks[0].end) : "";
  const theorems = theoremEnvs(pre);
  // What each label names, for \cref and \autoref.
  const kinds = new Map<string, string>(look.kinds ?? []);
  const HEAD = ["part", "chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph"];
  for (const b of blocks) {
    const src = text.slice(b.start, b.end);
    let kind: string | undefined;
    if (b.kind === "figure" && b.figure) kind = b.figure.env.replace("*", "");
    else if (b.kind === "math") kind = "equation";
    else if (b.kind === "heading") kind = HEAD[b.level ?? 2];
    else if (b.kind === "code" && b.env) kind = theorems.get(b.env)?.title.toLowerCase();
    if (!kind) continue;
    for (const m of src.matchAll(/\\label\{([^}]*)\}/g)) if (!kinds.has(m[1])) kinds.set(m[1], kind);
  }
  const lk = { ...look, kinds };
  const inline = (start: number, end: number) => markNodes(tokenize(text.slice(start, end), lk, start), marks, srcLen, start, end, shown);
  const vtext = (r: { start: number; end: number } | null): VText | null => (r ? { start: r.start, end: r.end, nodes: inline(r.start, r.end), src: text.slice(r.start, r.end) } : null);
  const vlist = (l: ListInfo): VList => ({ env: l.env, items: l.items.map((it) => ({ text: vtext(it.text)!, label: vtext(it.label), sub: it.sub.map(vlist) })) });
  const thmCount: Record<string, number> = {};
  const titleOf = (to: number): NonNullable<VBlock["titleBlock"]> => {
    // Read the meta-data in order, as achemso does: \affiliation goes to every earlier author without one,
    // \alsoaffiliation, \altaffiliation and \email to the author just before.
    type A = { r: VText; aff: string[]; alt: string[]; star: boolean };
    const authors: A[] = [];
    const affs = new Map<string, { text: VText; alt: boolean }>();
    let phone: string | undefined;
    let fax: string | undefined;
    const emails: string[] = [];
    const re = /\\(author|affiliation|alsoaffiliation|altaffiliation|email|phone|fax)\s*(?:\[[^\]]*\]\s*)?\{/g;
    for (let m = re.exec(text); m && m.index < to; m = re.exec(text)) {
      const r = commandArg(text, m[1], m.index, to);
      if (!r || r.start !== m.index + m[0].length) continue;
      const src = text.slice(r.start, r.end);
      const key = src.replace(/\s+/g, " ").trim();
      const last = authors[authors.length - 1];
      switch (m[1]) {
        case "author": authors.push({ r: vtext(r)!, aff: [], alt: [], star: false }); break;
        case "affiliation":
          if (!affs.has(key)) affs.set(key, { text: vtext(r)!, alt: false });
          for (const a of authors) if (!a.aff.length) a.aff.push(key);
          break;
        case "alsoaffiliation":
          if (!affs.has(key)) affs.set(key, { text: vtext(r)!, alt: false });
          if (last && !last.aff.includes(key)) last.aff.push(key);
          break;
        case "altaffiliation":
          if (!affs.has(key)) affs.set(key, { text: vtext(r)!, alt: true });
          if (last && !last.alt.includes(key)) last.alt.push(key);
          break;
        case "email": emails.push(key); if (last) last.star = true; break;
        case "phone": phone = key; break;
        case "fax": fax = key; break;
      }
      re.lastIndex = r.end;
    }
    // Affiliations first, then the other notes; each gets the next footnote symbol († is the title's).
    const order = [...affs.entries()].filter(([, v]) => !v.alt).concat([...affs.entries()].filter(([, v]) => v.alt));
    const SYMBOLS = ["\u2021", "\u00b6", "\u00a7", "\u2016", "\u22a5", "#", "\u25b3", "\u2207", "\u25bd"];
    const marked = order.length > 1 || order.some(([, v]) => v.alt);
    const sym = new Map(order.map(([k], i) => [k, marked ? SYMBOLS[i] ?? String(i + 1) : ""]));
    return {
      title: vtext(commandArg(text, "title", 0, to)),
      authors: authors.map((a) => a.r),
      authorMarks: authors.map((a) => {
        const idx = [...a.aff, ...a.alt].map((k) => order.findIndex(([x]) => x === k)).sort((x, y) => x - y);
        return [...(a.star && authors.length > 1 ? ["*"] : []), ...idx.map((i) => sym.get(order[i][0]) ?? "")].filter(Boolean).join(",");
      }),
      date: vtext(commandArg(text, "date", 0, to)),
      affiliations: order.map(([k, v]) => ({ text: v.text, mark: sym.get(k) ?? "" })),
      emails,
      phone,
      fax,
    };
  };
  const WRAP_TITLES: Record<string, string> = {
    abstract: "Abstract", acknowledgement: "Acknowledgement", acknowledgements: "Acknowledgements", acknowledgment: "Acknowledgment", acknowledgments: "Acknowledgments",
    suppinfo: "Supporting Information Available", tocentry: "TOC Graphic",
  };
  const openStack: string[] = [];
  const out: VBlock[] = blocks.map((b) => {
    const vb: VBlock = { kind: b.kind, start: b.start, end: b.end, src: text.slice(b.start, b.end) };
    if (b.wrap === "end") openStack.pop();
    if (openStack.length) vb.within = openStack[openStack.length - 1];
    if (b.wrap && b.env) {
      vb.wrap = { env: b.env, side: b.wrap, title: WRAP_TITLES[b.env] ?? "" };
      vb.hideSource = true;
      if (b.wrap === "begin") openStack.push(b.env);
    }
    vb.changed = marks.some((m) => m.curStart <= b.end && (m.curEnd > b.start || (m.curEnd === m.curStart && m.curStart >= b.start)));
    if (b.kind === "code" && inp.bbl?.length && /\\(bibliography|printbibliography)\b/.test(vb.src)) {
      vb.bib = inp.bbl.map((e) => ({ label: e.label, nodes: tokenize(e.tex, look) as MNode[] }));
    }
    if (b.kind === "list") {
      const at = b.start + (/^[ \t]*/.exec(vb.src)?.[0].length ?? 0);
      const l = parseList(text, at);
      if (l) vb.list = vlist(l);
    }
    if (b.kind === "code" && !b.wrap) {
      vb.commentOnly = vb.src.split("\n").every((l) => !l.trim() || /^\s*%/.test(l));
      const at = b.start + (/^[ \t]*/.exec(vb.src)?.[0].length ?? 0);
      const box = b.env ? envBox(text, at, theorems) : null;
      if (box) {
        const t = theorems.get(box.env) ?? theorems.get(box.env.replace(/\*$/, ""));
        let num: string | undefined;
        if (t?.numbered && !box.env.endsWith("*")) { thmCount[box.env] = (thmCount[box.env] ?? 0) + 1; num = String(thmCount[box.env]); }
        const lab = /\\label\{([^}]*)\}/.exec(text.slice(box.inner.start, box.inner.end));
        if (num && lab) num = look.labels?.get(lab[1]) ?? num;
        vb.envbox = { title: box.title, num, note: vtext(box.note), inner: vtext(box.inner)! };
      } else if (/\\maketitle\b/.test(vb.src)) {
        vb.titleBlock = titleOf(b.start);
        vb.hideSource = onlyCommands(vb.src, ["maketitle"]);
      } else {
        const paths = inputPaths(vb.src);
        if (paths.length) {
          vb.inputs = paths.map((p) => ({ path: p, file: inp.inputFile?.(p) }));
          vb.hideSource = onlyCommands(vb.src, ["input", "include", "subfile", "subfileinclude", "import", "subimport"]);
        }
      }
    }
    if (b.kind === "para") {
      // Leading indentation is kept as plain text so the source keeps it.
      vb.nodes = inline(b.start, b.end);
    } else if (b.kind === "heading" && b.title) {
      vb.level = b.level;
      vb.num = nums.get(b);
      vb.title = { ...b.title, nodes: inline(b.title.start, b.title.end) };
    } else if (b.kind === "figure" && b.figure) {
      const f = b.figure;
      const base = f.env.replace("*", "");
      counters[base] = (counters[base] ?? 0) + 1;
      const num = (f.label && look.labels?.get(f.label.text)) || String(counters[base]);
      vb.fig = {
        start: f.start,
        env: base,
        num,
        images: inp.images(f).map((im) => (im.labels ? { ...im, labels: im.labels.map((l) => ({ ...l, nodes: tokenize(l.tex, look) as MNode[] })) } : im)),
        caption: f.caption ? { start: f.caption.start, end: f.caption.end, nodes: inline(f.caption.start, f.caption.end) } : null,
        label: f.label ? { start: f.label.start, end: f.label.end, text: f.label.text } : null,
      };
    } else if (b.kind === "math") {
      const src = vb.src.trim();
      if (b.env === "\\[") vb.tex = src.replace(/^\\\[/, "").replace(/\\\]\s*$/, "");
      else if (b.env === "$$") vb.tex = src.replace(/^\$\$/, "").replace(/\$\$\s*$/, "");
      else {
        // Numbers come from the document, not from KaTeX's own counter.
        const env = b.env ?? "";
        const inner = src.replace(new RegExp(`^\\\\begin\\{${env.replace("*", "\\*")}\\}`), "").replace(new RegExp(`\\\\end\\{${env.replace("*", "\\*")}\\}\\s*$`), "");
        if (env === "equation") {
          eq++;
          const lab = /\\label\{([^}]*)\}/.exec(src);
          vb.num = (lab && look.labels?.get(lab[1])) || String(eq);
          vb.tex = /\\nonumber|\\notag/.test(inner) ? inner : `${inner}\\tag{${vb.num}}`;
        } else if (env === "equation*" || env === "displaymath") vb.tex = inner;
        else vb.tex = `\\begin{${env.endsWith("*") ? env : env + "*"}}${inner}\\end{${env.endsWith("*") ? env : env + "*"}}`;
      }
      // KaTeX does not know \label; drop it from what is drawn.
      vb.tex = vb.tex.replace(/\\label\{[^}]*\}/g, "").replace(/\\nonumber|\\notag/g, "");
    }
    return vb;
  });
  marks.forEach((m, c) => {
    if (!m.deleted || shown.has(c)) return;
    const inPreamble = blocks[0]?.kind === "preamble" && m.curStart < blocks[0].end;
    if (inPreamble) return;
    let i = out.findIndex((b) => b.start >= m.curStart || b.kind === "tail");
    if (i < 0) i = out.length;
    out.splice(i, 0, { kind: "deleted", start: m.curStart, end: m.curStart, src: "", nodes: [{ t: "del", s: m.deleted, c }], changed: true });
  });
  const cls0 = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/.exec(pre);
  if (cls0?.[1].trim() === "achemso" && !out.some((b) => b.titleBlock) && blocks[0]?.kind === "preamble") {
    // achemso prints the title on its own at \begin{document}.
    const at = blocks[0].end;
    out.splice(1, 0, { kind: "code", start: at, end: at, src: "", titleBlock: titleOf(at), virtual: true, hideSource: true });
  }
  const natbib = /\\usepackage\s*\[([^\]]*)\]\s*\{natbib\}/.exec(pre.replace(/(^|[^\\])%.*$/gm, "$1"));
  const cls = /\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/.exec(pre);
  const achemso = cls?.[2].trim() === "achemso";
  const size = /\b(1[012])pt\b/.exec(cls?.[1] ?? "");
  // achemso is 12pt; article and most classes default to 10pt.
  const fontPt = size ? Number(size[1]) : achemso ? 12 : 10;
  return {
    uri: inp.uri,
    version: inp.version,
    name: inp.name,
    docClass: cls?.[2].trim() ?? "",
    superCites: !!(natbib && /\bsuper\b/.test(natbib[1])) || achemso,
    fontPt,
    // mhchem's \ce is KaTeX's own; a preamble stand-in for it would hide it.
    macros: Object.fromEntries(Object.entries(preambleMacros(pre)).filter(([k]) => k !== "\\ce" && k !== "\\pu")),
    tracking: inp.tracking,
    changes: marks,
    blocks: out,
  };
}
