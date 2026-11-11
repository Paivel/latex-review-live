// Facts about a figure's files: the PDF's size and the labels Reactio Draw sets over it.
import * as fs from "fs";


/** The first page's MediaBox of a PDF, in pt. */
export function pdfSize(pdf: string): { w: number; h: number } | undefined {
  try {
    const m = /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/.exec(fs.readFileSync(pdf).toString("latin1"));
    if (!m) return undefined;
    const [x0, y0, x1, y1] = m.slice(1).map(Number);
    return { w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
  } catch { return undefined; }
}

/** The text a Reactio Draw figure sets over its drawing: \node at (x,y) {...} inside the scope. */
export function reactioLabels(tex: string): { x: number; y: number; size: number; tex: string }[] | undefined {
  let src: string;
  try { src = fs.readFileSync(tex, "utf8"); } catch { return undefined; }
  if (!/Reactio Draw/.test(src)) return undefined;
  const out: { x: number; y: number; size: number; tex: string }[] = [];
  const re = /\\node\s+at\s*\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)\s*\{/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const open = m.index + m[0].length - 1;
    let depth = 0, k = open;
    for (; k < src.length; k++) {
      if (src[k] === "\\") { k++; continue; }
      if (src[k] === "{") depth++;
      else if (src[k] === "}" && --depth === 0) break;
    }
    let body = src.slice(open + 1, k);
    const fs_ = /\\fontsize\{([\d.]+)\}/.exec(body);
    body = body.replace(/\\reactiofigurefont\{[^}]*\}|\\fontsize\{[^}]*\}\{[^}]*\}|\\selectfont\b\s*/g, "").trim();
    out.push({ x: Number(m[1]), y: Number(m[2]), size: fs_ ? Number(fs_[1]) : 10, tex: body });
  }
  return out.length ? out : undefined;
}
