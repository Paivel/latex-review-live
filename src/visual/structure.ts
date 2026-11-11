// Lists, the title block, theorem-like environments and \input lines: where their editable text is. Pure functions on the text.
import { matchBrace } from "./figure";

export interface Range { start: number; end: number }

export interface ListItem {
  /** The item's own text (before any nested list), trimmed. */
  text: Range;
  /** description's \item[term], or a custom label. */
  label: Range | null;
  sub: ListInfo[];
}

export interface ListInfo {
  env: string;
  items: ListItem[];
}

export const LIST_ENVS = ["itemize", "enumerate", "description"];

const trimRange = (text: string, a: number, b: number): Range => {
  while (a < b && /\s/.test(text[a])) a++;
  while (b > a && /\s/.test(text[b - 1])) b--;
  return { start: a, end: b };
};

/** Commented position: a % before it on its line. */
function commented(text: string, at: number): boolean {
  const ls = text.lastIndexOf("\n", at - 1) + 1;
  for (let i = ls; i < at; i++) {
    if (text[i] === "\\") { i++; continue; }
    if (text[i] === "%") return true;
  }
  return false;
}

/** Index just past the \end{env} that closes the \begin{env} at `at`, or -1. */
function closeOf(text: string, at: number, env: string): number {
  const re = new RegExp(`\\\\(begin|end)\\{${env.replace("*", "\\*")}\\}`, "g");
  re.lastIndex = at;
  let depth = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (commented(text, m.index)) continue;
    depth += m[1] === "begin" ? 1 : -1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

/** The list environment that begins at `at` (\begin{itemize}...). */
export function parseList(text: string, at: number): ListInfo | null {
  const m = /^\\begin\{(itemize|enumerate|description)\}(\s*\[[^\]]*\])?/.exec(text.slice(at, at + 200));
  if (!m) return null;
  const env = m[1];
  const close = closeOf(text, at, env);
  if (close < 0) return null;
  const bodyStart = at + m[0].length;
  const bodyEnd = close - `\\end{${env}}`.length;
  // \item at this level: skip nested environments and groups.
  const items: { at: number; after: number; label: Range | null }[] = [];
  const nested: { start: number; end: number; info: ListInfo | null }[] = [];
  let i = bodyStart;
  while (i < bodyEnd) {
    const c = text[i];
    if (c === "%") { const nl = text.indexOf("\n", i); i = nl < 0 ? bodyEnd : nl + 1; continue; }
    if (c === "{") { const e = matchBrace(text, i); i = e < 0 ? bodyEnd : e + 1; continue; }
    if (c !== "\\") { i++; continue; }
    const b = /^\\begin\{([^}]+)\}/.exec(text.slice(i, i + 60));
    if (b) {
      const e = closeOf(text, i, b[1]);
      const end = e < 0 ? bodyEnd : Math.min(e, bodyEnd);
      nested.push({ start: i, end, info: LIST_ENVS.includes(b[1]) ? parseList(text, i) : null });
      i = end;
      continue;
    }
    const it = /^\\item\b[ \t]*/.exec(text.slice(i, i + 20));
    if (it) {
      let after = i + it[0].length;
      let label: Range | null = null;
      if (text[after] === "[") {
        const e = text.indexOf("]", after);
        if (e > 0 && e < bodyEnd) { label = { start: after + 1, end: e }; after = e + 1; }
      }
      items.push({ at: i, after, label });
      i = after;
      continue;
    }
    i += 2;
  }
  const out: ListItem[] = items.map((it, k) => {
    const to = k + 1 < items.length ? items[k + 1].at : bodyEnd;
    const subs = nested.filter((n) => n.start >= it.after && n.end <= to);
    // The item's text runs to its first nested environment.
    const textEnd = subs.length ? subs[0].start : to;
    // Text starts right after "\item " (an empty item is there too); its end drops trailing space.
    let a = it.after;
    while (a < textEnd && (text[a] === " " || text[a] === "\t")) a++;
    let b = textEnd;
    while (b > a && /\s/.test(text[b - 1])) b--;
    if (a < b && text[a] === "\n") a = trimRange(text, a, b).start;
    return { text: { start: a, end: b }, label: it.label, sub: subs.map((n) => n.info).filter((x): x is ListInfo => !!x) };
  });
  return { env, items: out };
}

/** The braced argument of the first \name{..} in text (outside comments), as a range inside the braces. */
export function commandArg(text: string, name: string, from = 0, to = text.length): Range | null {
  const re = new RegExp(`\\\\${name}\\s*(?:\\[[^\\]]*\\]\\s*)?\\{`, "g");
  re.lastIndex = from;
  for (let m = re.exec(text); m && m.index < to; m = re.exec(text)) {
    if (commented(text, m.index)) continue;
    const open = m.index + m[0].length - 1;
    const close = matchBrace(text, open);
    if (close < 0 || close > to) return null;
    return { start: open + 1, end: close };
  }
  return null;
}

// ---- Theorem-like environments --------------------------------------------

const DEFAULT_THEOREMS: Record<string, string> = {
  theorem: "Theorem", lemma: "Lemma", proposition: "Proposition", corollary: "Corollary",
  definition: "Definition", remark: "Remark", example: "Example", conjecture: "Conjecture", claim: "Claim",
  assumption: "Assumption", note: "Note", exercise: "Exercise", problem: "Problem",
};

/** Theorem-like environments: the defaults plus \newtheorem{name}{Title} / \newtheorem*{name}{Title} in the preamble. */
export function theoremEnvs(pre: string): Map<string, { title: string; numbered: boolean }> {
  const out = new Map<string, { title: string; numbered: boolean }>();
  for (const [k, v] of Object.entries(DEFAULT_THEOREMS)) out.set(k, { title: v, numbered: true });
  const clean = pre.replace(/(^|[^\\])%.*$/gm, "$1");
  for (const m of clean.matchAll(/\\newtheorem(\*?)\s*\{([^}]+)\}\s*(?:\[[^\]]*\]\s*)?\{([^}]+)\}/g)) {
    out.set(m[2].trim(), { title: m[3].trim(), numbered: !m[1] });
  }
  return out;
}

export interface EnvBox {
  env: string;
  /** "Theorem", "Proof", "Abstract". */
  title: string;
  /** The optional [note] after \begin{env}. */
  note: Range | null;
  inner: Range;
}

/** A theorem-like environment, proof or abstract starting at `at`. */
export function envBox(text: string, at: number, theorems: Map<string, { title: string; numbered: boolean }>): EnvBox | null {
  const m = /^\\begin\{([^}]+)\}/.exec(text.slice(at, at + 80));
  if (!m) return null;
  const env = m[1];
  const base = env.replace(/\*$/, "");
  const title = base === "proof" ? "Proof" : base === "abstract" ? "Abstract" : theorems.get(env)?.title ?? theorems.get(base)?.title;
  if (!title) return null;
  const close = closeOf(text, at, env);
  if (close < 0) return null;
  let i = at + m[0].length;
  let note: Range | null = null;
  const o = /^\s*\[/.exec(text.slice(i, i + 20));
  if (o) {
    const e = text.indexOf("]", i + o[0].length);
    if (e > 0) { note = { start: i + o[0].length, end: e }; i = e + 1; }
  }
  return { env, title, note, inner: trimRange(text, i, close - `\\end{${env}}`.length) };
}

// ---- \input lines -----------------------------------------------------------

/** \input{x}, \include{x}, \subfile{x}, \import{dir}{x} on command-only lines. */
export function inputPaths(src: string): string[] {
  const out: string[] = [];
  const clean = src.replace(/(^|[^\\])%.*$/gm, "$1");
  for (const m of clean.matchAll(/\\(?:input|include|subfile|subfileinclude)\s*\{([^}]+)\}|\\(?:sub)?import\*?\s*\{([^}]*)\}\s*\{([^}]+)\}/g)) {
    out.push(m[1] ? m[1].trim() : (m[2].trim() + m[3].trim()));
  }
  return out;
}

/** Only these commands (and comments) on the block's lines: the visual editor can stand in for the source. */
export function onlyCommands(src: string, names: string[]): boolean {
  const re = new RegExp(`^\\s*(?:(?:\\\\(?:${names.join("|")})\\*?\\s*(?:\\[[^\\]]*\\]\\s*)?(?:\\{[^{}]*\\}\\s*)*)+|%.*)?\\s*$`);
  return src.split("\n").every((l) => re.test(l));
}
