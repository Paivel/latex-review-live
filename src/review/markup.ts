import { Change } from "./diff";
import { StoredThread } from "./model";

/**
 * Where math mode is on, as a per-offset test. Knows $…$, $$…$$, \(…\), \[…\]
 * and the usual display environments; ignores % comments and \$.
 */
export function mathMap(text: string): (offset: number) => boolean {
  const spans: [number, number][] = [];
  const envs = /^(equation|align|gather|multline|flalign|alignat|eqnarray|math|displaymath)\*?$/;
  let i = 0;
  let open: { at: number; close: string } | undefined;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      const rest = text.slice(i, i + 40);
      if (!open) {
        if (rest.startsWith("\\(")) open = { at: i, close: "\\)" };
        else if (rest.startsWith("\\[")) open = { at: i, close: "\\]" };
        else {
          const m = /^\\begin\{([a-zA-Z*]+)\}/.exec(rest);
          if (m && envs.test(m[1])) open = { at: i, close: `\\end{${m[1]}}` };
        }
      } else if (text.startsWith(open.close, i)) {
        spans.push([open.at, i + open.close.length]);
        i += open.close.length;
        open = undefined;
        continue;
      }
      i += 2;
      continue;
    }
    if (ch === "%") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (ch === "$") {
      const dbl = text[i + 1] === "$";
      if (!open) {
        open = { at: i, close: dbl ? "$$" : "$" };
        i += dbl ? 2 : 1;
        continue;
      }
      if (text.startsWith(open.close, i)) {
        spans.push([open.at, i + open.close.length]);
        i += open.close.length;
        open = undefined;
        continue;
      }
    }
    i++;
  }
  return (o: number) => spans.some(([a, b]) => o > a && o < b);
}

function balanced(s: string): boolean {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}" && --depth < 0) return false;
  }
  return depth === 0;
}

/** Text that the changes package can wrap: no math, no paragraph break, balanced braces, no structure. */
function wrappable(s: string): boolean {
  return balanced(s) && !/\$|\\[()[\]]|\\(begin|end|item|section|subsection|chapter|par|label|caption)\b|%|\n\s*\n/.test(s);
}

export function escapeTeX(s: string): string {
  return s
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([%&#_$])/g, "\\$1")
    .replace(/([{}])/g, "\\$1")
    .replace(/\\textbackslash\\\{\\\}/g, "\\textbackslash{}")
    .replace(/\^/g, "\\^{}")
    .replace(/~/g, "\\~{}")
    .replace(/\s*\n\s*/g, " ");
}

/**
 * A copy of the document with tracked changes as \added, \deleted and \replaced
 * and open comments as \comment, for a PDF to send to co-authors.
 */
export function markUp(text: string, changes: Change[], threads: StoredThread[], opts: { sameLines?: boolean } = {}): { text: string; plain: number } {
  // sameLines: every line stays on its line number (deleted text joins one line), so SyncTeX lines are the document's.
  const del = (s: string) => (opts.sameLines ? s.replace(/\s*\n\s*/g, " ") : s);
  const inMath = mathMap(text);
  type Ins = { at: number; end: number; text: string };
  const ops: Ins[] = [];
  let plain = 0;
  for (const c of changes) {
    const ok = !inMath(c.curStart) && !inMath(c.curEnd) && (c.deleted === "" || wrappable(c.deleted)) && (c.inserted === "" || wrappable(c.inserted));
    if (!ok) {
      plain++;
      continue;
    }
    let rep: string;
    if (c.deleted === "") rep = `\\added{${c.inserted}}`;
    else if (c.inserted === "") rep = `\\deleted{${del(c.deleted)}}`;
    else rep = `\\replaced{${c.inserted}}{${del(c.deleted)}}`;
    ops.push({ at: c.curStart, end: c.curEnd, text: rep });
  }
  for (const t of threads) {
    let at = t.end;
    while (at < text.length && inMath(at)) at++;
    const body = t.comments.map((c) => `${c.author ? escapeTeX(c.author) + ": " : ""}${escapeTeX(c.body)}`).join(" / ");
    ops.push({ at, end: at, text: `\\comment{${body}}` });
  }
  // Apply from the end; at equal offsets keep the order they were added in.
  ops.sort((a, b) => b.at - a.at || b.end - a.end);
  let out = text;
  for (const op of ops) out = out.slice(0, op.at) + op.text + out.slice(op.end);

  const pkg = "\\usepackage[markup=default]{changes}% added by LaTeX Review\n";
  if (!/\\usepackage(\[[^\]]*\])?\{changes\}/.test(out) && opts.sameLines) {
    // Right after \documentclass{..}, on its line.
    const m = /\\documentclass(\[[^\]]*\])?\{[^}]*\}/.exec(out);
    if (m) out = out.slice(0, m.index + m[0].length) + "\\usepackage[markup=default]{changes}" + out.slice(m.index + m[0].length);
  } else if (!/\\usepackage(\[[^\]]*\])?\{changes\}/.test(out)) {
    const m = /\\documentclass(\[[^\]]*\])?\{[^}]*\}[^\n]*\n/.exec(out);
    if (m) out = out.slice(0, m.index + m[0].length) + pkg + out.slice(m.index + m[0].length);
    else {
      const b = out.indexOf("\\begin{document}");
      if (b >= 0) out = out.slice(0, b) + pkg + out.slice(b);
    }
  }
  return { text: out, plain };
}
