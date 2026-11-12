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
  /** \includegraphics[..] options, as written. */
  options?: string;
  /** Offsets of the whole command (\includegraphics[..]{..} or \input{..}). */
  at?: number;
  end?: number;
  /** A \resizebox{0.5\linewidth}{!}{..} around it: offsets of its width argument and the share it gives. */
  resize?: { start: number; end: number; frac: number };
}

/** The share of the line a graphic is set at, from its options or a \resizebox around it. */
export function graphicWidth(g: Graphic): { frac?: number; pt?: number; scale?: number } {
  if (g.resize) return { frac: g.resize.frac };
  return g.kind === "graphics" ? graphicSize(g.options) : {};
}

const fracText = (frac: number) => {
  const f = Math.round(Math.min(1, Math.max(0.05, frac)) * 100) / 100;
  return f >= 1 ? "\\linewidth" : `${f}\\linewidth`;
};

/**
 * The edit that sets a graphic to a share of the line: width= in \includegraphics (other size options go),
 * or a \resizebox around an \input drawing (its width argument when there already is one).
 */
export function widthEdit(text: string, g: Graphic, frac: number): { start: number; end: number; text: string } | null {
  if (g.at === undefined || g.end === undefined) return null;
  const w = fracText(frac);
  if (g.resize) return { start: g.resize.start, end: g.resize.end, text: w };
  const cmd = text.slice(g.at, g.end);
  if (g.kind === "input") return { start: g.at, end: g.end, text: `\\resizebox{${w}}{!}{${cmd}}` };
  const m = /^(\\includegraphics\*?)\s*(?:\[([^\]]*)\]\s*)?(\{[\s\S]*\})$/.exec(cmd);
  if (!m) return null;
  const keep = (m[2] ?? "").split(",").map((o) => o.trim()).filter((o) => o && !/^(width|height|scale|totalheight)\s*=/.test(o));
  return { start: g.at, end: g.end, text: `${m[1]}[${[`width=${w}`, ...keep].join(",")}]${m[3]}` };
}

/** The size \includegraphics options ask for: a share of the line (width=0.6\linewidth), a width in pt, or a scale. */
export function graphicSize(options: string | undefined): { frac?: number; pt?: number; scale?: number } {
  if (!options) return {};
  const w = /(?:^|,)\s*width\s*=\s*([\d.]*)\s*\\(linewidth|textwidth|columnwidth|hsize)/.exec(options);
  if (w) return { frac: w[1] ? Number(w[1]) : 1 };
  const units: Record<string, number> = { pt: 1, bp: 72.27 / 72, mm: 2.84528, cm: 28.4528, in: 72.27, pc: 12 };
  const a = /(?:^|,)\s*width\s*=\s*([\d.]+)\s*(pt|bp|mm|cm|in|pc)/.exec(options);
  if (a) return { pt: Number(a[1]) * units[a[2]] };
  const sc = /(?:^|,)\s*scale\s*=\s*([\d.]+)/.exec(options);
  if (sc) return { scale: Number(sc[1]) };
  return {};
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
  for (const m of body.matchAll(/\\(includegraphics\*?|input|include|includepdf)\s*(?:\[([^\]]*)\]\s*)?\{([^}]*)\}/g)) {
    if (commented(text, bodyStart + m.index!)) continue;
    const at = bodyStart + m.index!;
    const g: Graphic = { kind: m[1].startsWith("include") && m[1] !== "include" ? "graphics" : "input", path: m[3].trim(), options: m[2], at, end: at + m[0].length };
    // \resizebox{0.8\linewidth}{!}{\input{..}}: the box sets the size.
    const before = /\\resizebox\*?\s*\{\s*([\d.]*)\s*\\(?:linewidth|textwidth|columnwidth|hsize)\s*\}\s*\{\s*!\s*\}\s*\{\s*$/.exec(text.slice(Math.max(0, at - 120), at));
    if (before && /^\s*\}/.test(text.slice(g.end!, g.end! + 20))) {
      const argStart = at - before[0].length + before[0].indexOf("{") + 1;
      const argEnd = text.indexOf("}", argStart);
      g.resize = { start: argStart, end: argEnd, frac: before[1] ? Number(before[1]) : 1 };
    }
    graphics.push(g);
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

/** The [htbp] after \begin{env}: offsets inside the brackets, or null. */
export function placementOf(text: string, f: FigureInfo): Field | null {
  if (f.env === "wrapfigure") return null;
  const open = text.indexOf("}", f.start) + 1;
  const m = /^[ \t]*\[([^\]]*)\]/.exec(text.slice(open, f.bodyStart));
  if (!m) return null;
  const start = open + m[0].indexOf("[") + 1;
  return { start, end: start + m[1].length, text: m[1] };
}

/** The edit that sets a float's placement ("h", "t", "b", "p", "htbp", "H"…). */
export function placementEdit(text: string, f: FigureInfo, spec: string): { start: number; end: number; text: string } | null {
  if (f.env === "wrapfigure") return null;
  const p = placementOf(text, f);
  if (!spec) return p ? { start: p.start - 1, end: p.end + 1, text: "" } : null;
  if (p) return { start: p.start, end: p.end, text: spec };
  const at = text.indexOf("}", f.start) + 1;
  return { start: at, end: at, text: `[${spec}]` };
}

/**
 * Edits that move a whole float to the line at `to` (a block's start): the float leaves with its own lines
 * and one blank line after it, and arrives followed by a blank line. Null when `to` is inside the float.
 */
export function moveEdits(text: string, f: FigureInfo, to: number): { start: number; end: number; text: string }[] | null {
  const lineStart = (at: number) => text.lastIndexOf("\n", at - 1) + 1;
  let from = lineStart(f.start);
  if (text.slice(from, f.start).trim()) from = f.start;
  let end = f.end;
  const rest = /^[ \t]*\n(?:[ \t]*\n)?/.exec(text.slice(end));
  if (rest) end += rest[0].length;
  const at = lineStart(to);
  if (at >= from && at <= end) return null;
  const body = text.slice(from, f.end);
  return [
    { start: from, end, text: "" },
    { start: at, end: at, text: `${body}\n\n` },
  ];
}

/** Edits that switch figure ↔ figure* (one column ↔ both columns) in \begin and \end. Null for floats without a starred form. */
export function spanEdits(text: string, f: FigureInfo): { start: number; end: number; text: string }[] | null {
  const base = f.env.replace("*", "");
  if (!["figure", "scheme", "chart", "graph"].includes(base)) return null;
  const to = f.env.endsWith("*") ? base : `${base}*`;
  const b = text.indexOf("{", f.start) + 1;
  const e = text.lastIndexOf("{", f.end) + 1;
  return [
    { start: b, end: b + f.env.length, text: to },
    { start: e, end: e + f.env.length, text: to },
  ];
}
