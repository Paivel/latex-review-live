// Finding the float at the cursor and its parts. Pure functions on the text.

export const FLOAT_ENVS = ["figure", "figure*", "scheme", "scheme*", "chart", "chart*", "graph", "graph*", "wrapfigure", "SCfigure"];

export interface Field {
  /** Offsets of the argument's content, inside the braces. */
  start: number;
  end: number;
  text: string;
}

export interface Graphic {
  /** "graphics" for \includegraphics, "input" for \input / \include. */
  kind: "graphics" | "input";
  path: string;
}

export interface FigureInfo {
  env: string;
  start: number;
  end: number;
  /** Offset just after \begin{env}[...] (and wrapfigure's arguments). */
  bodyStart: number;
  /** Offset of \end{env}. */
  bodyEnd: number;
  graphics: Graphic[];
  caption: Field | null;
  label: Field | null;
}

/** Index of the brace closing the one at `open`, or -1. Skips escaped braces and comments. */
export function matchBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") { i++; continue; }
    if (c === "%") { const nl = text.indexOf("\n", i); if (nl < 0) return -1; i = nl; continue; }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
}

/** Offsets of comment starts, so matches inside comments can be ignored. */
function commented(text: string, at: number): boolean {
  const ls = text.lastIndexOf("\n", at - 1) + 1;
  for (let i = ls; i < at; i++) {
    if (text[i] === "\\") { i++; continue; }
    if (text[i] === "%") return true;
  }
  return false;
}

const esc = (s: string) => s.replace(/[*]/g, "\\*");

/** The float environment containing `offset`, or null. */
export function figureAt(text: string, offset: number): FigureInfo | null {
  const re = new RegExp(`\\\\(begin|end)\\{(${FLOAT_ENVS.map(esc).join("|")})\\}`, "g");
  const stack: { env: string; start: number; bodyStart: number }[] = [];
  for (const m of text.matchAll(re)) {
    const at = m.index!;
    if (commented(text, at)) continue;
    if (m[1] === "begin") {
      stack.push({ env: m[2], start: at, bodyStart: skipArgs(text, at + m[0].length, m[2]) });
      continue;
    }
    const open = stack.pop();
    if (!open || open.env !== m[2]) continue;
    const end = at + m[0].length;
    if (open.start <= offset && offset <= end) return describe(text, open.env, open.start, open.bodyStart, at, end);
    if (open.start > offset) return null;
  }
  return null;
}

/** All floats in the text, in order (outermost only). */
export function allFigures(text: string): FigureInfo[] {
  const out: FigureInfo[] = [];
  let at = 0;
  const re = new RegExp(`\\\\begin\\{(${FLOAT_ENVS.map(esc).join("|")})\\}`, "g");
  for (const m of text.matchAll(re)) {
    if (m.index! < at || commented(text, m.index!)) continue;
    const f = figureAt(text, m.index!);
    if (f && f.start === m.index) { out.push(f); at = f.end; }
  }
  return out;
}

function skipArgs(text: string, i: number, env: string): number {
  // Optional [placement]; wrapfigure also takes {r}{width} and SCfigure an [..] or two.
  const optional = () => { const m = /^\s*\[[^\]]*\]/.exec(text.slice(i, i + 200)); if (m) i += m[0].length; };
  const required = () => {
    const m = /^\s*\{/.exec(text.slice(i, i + 50));
    if (!m) return;
    const close = matchBrace(text, i + m[0].length - 1);
    if (close > 0) i = close + 1;
  };
  optional();
  if (env === "wrapfigure") { optional(); required(); optional(); required(); }
  else if (env === "SCfigure") optional();
  return i;
}

function describe(text: string, env: string, start: number, bodyStart: number, bodyEnd: number, end: number): FigureInfo {
  const body = text.slice(bodyStart, bodyEnd);
  const graphics: Graphic[] = [];
  for (const m of body.matchAll(/\\(includegraphics\*?|input|include|includepdf)\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}/g)) {
    if (commented(text, bodyStart + m.index!)) continue;
    graphics.push({ kind: m[1].startsWith("include") && m[1] !== "include" ? "graphics" : "input", path: m[2].trim() });
  }
  return { env, start, end, bodyStart, bodyEnd, graphics, caption: arg(text, bodyStart, bodyEnd, "caption"), label: arg(text, bodyStart, bodyEnd, "label") };
}

/** The first \name[...]{...} argument between from and to (outside comments, at the float's own level). */
function arg(text: string, from: number, to: number, name: string): Field | null {
  const re = new RegExp(`\\\\${name}\\*?\\s*(?:\\[[^\\]]*\\]\\s*)?\\{`, "g");
  re.lastIndex = from;
  for (let m = re.exec(text); m && m.index < to; m = re.exec(text)) {
    if (commented(text, m.index)) continue;
    // Skip \caption inside a nested subfigure etc. only if not at depth 0: keep it simple and take the first.
    const open = m.index + m[0].length - 1;
    const close = matchBrace(text, open);
    if (close < 0 || close > to) return null;
    return { start: open + 1, end: close, text: text.slice(open + 1, close) };
  }
  return null;
}

/** Directories from \graphicspath{{a/}{b/}}. */
export function graphicsPaths(text: string): string[] {
  const m = /\\graphicspath\s*\{((?:\s*\{[^}]*\})*)\s*\}/.exec(text);
  if (!m) return [];
  return [...m[1].matchAll(/\{([^}]*)\}/g)].map((x) => x[1]);
}

export const IMAGE_EXTS = [".pdf", ".png", ".jpg", ".jpeg", ".svg", ".gif", ".webp"];

/** Candidate image files for a graphic, relative to the document folder, best first. */
export function imageCandidates(g: Graphic, gpaths: string[]): string[] {
  const p = g.path.replace(/^"|"$/g, "");
  const dirs = ["", ...gpaths];
  const out: string[] = [];
  const hasImageExt = IMAGE_EXTS.some((e) => p.toLowerCase().endsWith(e));
  for (const d of dirs) {
    const base = d + p;
    if (g.kind === "graphics") {
      if (hasImageExt) out.push(base);
      else for (const e of IMAGE_EXTS) out.push(base + e);
    } else {
      // \input{figures/x} or {figures/x.tex}: a drawing's picture lives beside it.
      const stem = base.replace(/\.(tex|pdf_tex|tikz|pgf)$/i, "");
      for (const e of [".pdf", ".svg", ".png"]) out.push(stem + e);
    }
  }
  return out;
}

/** The edit that sets a field's text, inserting the command when the float lacks it. */
export function fieldEdit(text: string, f: FigureInfo, which: "caption" | "label", value: string): { start: number; end: number; text: string } {
  const field = f[which];
  if (field) return { start: field.start, end: field.end, text: value };
  // Insert on its own line: a caption before an existing label, otherwise before \end{env}.
  const lineStart = (at: number) => text.lastIndexOf("\n", at - 1) + 1;
  const indentOf = (at: number) => /^[ \t]*/.exec(text.slice(lineStart(at)))![0];
  let at: number;
  if (which === "caption" && f.label) at = lineStart(text.lastIndexOf("\\label", f.label.start));
  else at = lineStart(f.bodyEnd);
  const endIndent = indentOf(f.bodyEnd);
  const indent = which === "caption" && f.label ? indentOf(at) : (f.graphics.length || f.caption ? guessIndent(text, f) : endIndent + "  ");
  // \end{env} not at line start: put the new line right before it.
  if (text.slice(lineStart(f.bodyEnd), f.bodyEnd).trim() && at === lineStart(f.bodyEnd)) {
    return { start: f.bodyEnd, end: f.bodyEnd, text: `\\${which}{${value}}\n${endIndent}` };
  }
  return { start: at, end: at, text: `${indent}\\${which}{${value}}\n` };
}

function guessIndent(text: string, f: FigureInfo): string {
  const body = text.slice(f.bodyStart, f.bodyEnd);
  const m = /\n([ \t]*)\S/.exec(body);
  return m ? m[1] : "  ";
}
