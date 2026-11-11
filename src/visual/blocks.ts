// Splitting a LaTeX document into the blocks the visual editor shows.
import { FLOAT_ENVS, FigureInfo, figureAt } from "./figure";
import { groupEnd } from "./inline";

export type BlockKind = "preamble" | "heading" | "para" | "figure" | "math" | "list" | "code" | "tail";

export interface Block {
  kind: BlockKind;
  /** Source range of the whole block. */
  start: number;
  end: number;
  /** heading: level 0 (part) .. 5 (subparagraph), starred, and its title range. */
  level?: number;
  starred?: boolean;
  title?: { start: number; end: number };
  /** figure */
  figure?: FigureInfo;
  /** math: environment name, or "\\[" / "$$". */
  env?: string;
}

const HEADINGS = ["part", "chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph"];
export const MATH_ENVS = ["equation", "equation*", "align", "align*", "gather", "gather*", "multline", "multline*", "eqnarray", "eqnarray*", "displaymath", "flalign", "flalign*", "alignat", "alignat*"];
const LIST_ENVS = ["itemize", "enumerate", "description"];

/** Index just past the matching \end{env} for the \begin{env} at `at`, or -1. */
export function envEnd(text: string, at: number, env: string): number {
  const open = `\\begin{${env}}`;
  const close = `\\end{${env}}`;
  let depth = 0;
  let k = at;
  while (k < text.length) {
    const o = text.indexOf(open, k);
    const c = text.indexOf(close, k);
    if (c < 0) return -1;
    if (o >= 0 && o < c) { depth++; k = o + open.length; continue; }
    depth--;
    k = c + close.length;
    if (depth === 0) return k;
  }
  return -1;
}

const lineEnd = (t: string, at: number) => { const e = t.indexOf("\n", at); return e < 0 ? t.length : e; };

/** A line made only of commands (and their arguments), such as \maketitle or \bibliography{refs}. */
export function commandOnly(line: string): boolean {
  let i = 0;
  const s = line.trim();
  if (!s.startsWith("\\")) return false;
  while (i < s.length) {
    while (s[i] === " " || s[i] === "\t") i++;
    if (i >= s.length) break;
    if (s[i] === "%") return true;
    if (s[i] !== "\\") return false;
    let j = i + 1;
    while (j < s.length && /[a-zA-Z@]/.test(s[j])) j++;
    if (j === i + 1) return false;
    const name = s.slice(i + 1, j);
    if (/^(text\w+|emph|cite\w*|\w*cite|ref|eqref|cref|Cref|rcmpd|cmpd|LaTeX|TeX|ldots|dots|underline)$/.test(name)) return false;
    if (s[j] === "*") j++;
    for (;;) {
      while (s[j] === " ") j++;
      if (s[j] === "{") { const e = groupEnd(s, j); if (e < 0) return false; j = e; continue; }
      if (s[j] === "[") { const e = groupEnd(s, j, "[", "]"); if (e < 0) return false; j = e; continue; }
      break;
    }
    i = j;
  }
  return true;
}

export function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const begin = /\\begin\s*\{document\}/.exec(text);
  let i = 0;
  if (begin) {
    const e = lineEnd(text, begin.index + begin[0].length);
    blocks.push({ kind: "preamble", start: 0, end: Math.min(text.length, e + 1) });
    i = Math.min(text.length, e + 1);
  }
  const endDoc = text.indexOf("\\end{document}", i);
  const stop = endDoc >= 0 ? endDoc : text.length;

  while (i < stop) {
    // Skip blank lines.
    const ls = i;
    const le = Math.min(lineEnd(text, ls), stop);
    const line = text.slice(ls, le);
    if (!line.trim()) { i = le + 1; continue; }
    const indent = /^[ \t]*/.exec(line)![0].length;
    const p = ls + indent;
    const rest = text.slice(p, le);

    const env = /^\\begin\s*\{([^}]+)\}/.exec(rest);
    if (env) {
      const name = env[1];
      let e = envEnd(text, p, name);
      if (e < 0 || e > stop) e = le;
      const blockEnd = Math.min(lineEnd(text, e), stop);
      if (FLOAT_ENVS.includes(name)) {
        const f = figureAt(text, p);
        blocks.push({ kind: "figure", start: ls, end: blockEnd, figure: f ?? undefined });
      } else if (MATH_ENVS.includes(name)) blocks.push({ kind: "math", start: ls, end: blockEnd, env: name });
      else if (LIST_ENVS.includes(name)) blocks.push({ kind: "list", start: ls, end: blockEnd, env: name });
      else blocks.push({ kind: "code", start: ls, end: blockEnd, env: name });
      i = blockEnd + 1;
      continue;
    }
    if (rest.startsWith("\\[") || rest.startsWith("$$")) {
      const close = rest.startsWith("\\[") ? "\\]" : "$$";
      const c = text.indexOf(close, p + 2);
      const e = c < 0 || c > stop ? le : Math.min(lineEnd(text, c + 2), stop);
      blocks.push({ kind: "math", start: ls, end: e, env: rest.slice(0, 2) });
      i = e + 1;
      continue;
    }
    const h = /^\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)(\*?)\s*(\[[^\]]*\])?\s*\{/.exec(rest);
    if (h) {
      const open = p + h[0].length - 1;
      const close = groupEnd(text, open);
      if (close > 0) {
        const e = Math.max(close, Math.min(lineEnd(text, close), stop));
        blocks.push({ kind: "heading", start: ls, end: e, level: HEADINGS.indexOf(h[1]), starred: !!h[2], title: { start: open + 1, end: close - 1 } });
        i = e + 1;
        continue;
      }
    }
    if (rest.startsWith("%") || commandOnly(rest)) {
      // Consecutive comment or command-only lines form one code block.
      let e = le;
      for (;;) {
        const ns = e + 1;
        if (ns >= stop) break;
        const ne = Math.min(lineEnd(text, ns), stop);
        const nl = text.slice(ns, ne).trim();
        if (!nl || !(nl.startsWith("%") || commandOnly(nl)) || /^\\(begin|part|chapter|section|subsection|subsubsection|paragraph)\b/.test(nl) || nl.startsWith("\\[")) break;
        e = ne;
      }
      blocks.push({ kind: "code", start: ls, end: e });
      i = e + 1;
      continue;
    }
    // A paragraph: up to a blank line or a line that starts a block.
    let e = le;
    for (;;) {
      const ns = e + 1;
      if (ns >= stop) break;
      const ne = Math.min(lineEnd(text, ns), stop);
      const nl = text.slice(ns, ne).trim();
      if (!nl || /^\\(begin|part|chapter|section|subsection|subsubsection|paragraph|subparagraph|end)\b/.test(nl) || nl.startsWith("\\[") || nl.startsWith("$$")) break;
      e = ne;
    }
    blocks.push({ kind: "para", start: ls, end: e });
    i = e + 1;
  }
  if (endDoc >= 0) blocks.push({ kind: "tail", start: endDoc, end: text.length });
  // Clamp ends that ran past the text (a final line without a newline).
  for (const b of blocks) b.end = Math.min(b.end, text.length);
  return blocks;
}

/** Section numbers as LaTeX would print them (article-like: section counts from 1). */
export function headingNumbers(blocks: Block[]): Map<Block, string> {
  const counters = [0, 0, 0, 0, 0, 0, 0];
  const out = new Map<Block, string>();
  const top = blocks.some((b) => b.kind === "heading" && b.level === 1) ? 1 : 2;
  for (const b of blocks) {
    if (b.kind !== "heading" || b.starred || b.level === undefined || b.level > 4) continue;
    counters[b.level]++;
    for (let k = b.level + 1; k < counters.length; k++) counters[k] = 0;
    if (b.level < top) { out.set(b, String(counters[b.level])); continue; }
    out.set(b, counters.slice(top, b.level + 1).join("."));
  }
  return out;
}
