import { Piece } from "./parse";

export type LineKind = "text" | "code" | "blank";

/**
 * What each line shows in live preview: text, nothing but LaTeX code, or
 * nothing at all. The preamble (before bodyStart) is code.
 */
export function lineKinds(text: string, pieces: Piece[], bodyStart: number): LineKind[] {
  const visible = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    visible[i] = c === 32 || c === 9 || c === 10 || c === 13 ? 0 : 1;
  }
  const shows = new Set<number>(); // offsets where a replacement shows something
  for (const p of pieces) {
    if (p.hide || p.code) visible.fill(0, p.start, p.end);
    if (p.hide && p.text && p.text.replace(/[\s\u00a0↵]/g, "") !== "") shows.add(p.start);
  }
  const kinds: LineKind[] = [];
  let start = 0;
  const showsAt = [...shows].sort((a, b) => a - b);
  let si = 0;
  while (start <= text.length) {
    let end = text.indexOf("\n", start);
    if (end < 0) end = text.length;
    const raw = text.slice(start, end);
    let kind: LineKind;
    if (raw.trim() === "") kind = "blank";
    else if (end <= bodyStart) kind = "code";
    else {
      kind = "code";
      for (let i = start; i < end; i++)
        if (visible[i]) {
          kind = "text";
          break;
        }
      while (si < showsAt.length && showsAt[si] < start) si++;
      if (kind === "code" && si < showsAt.length && showsAt[si] < end) kind = "text";
    }
    kinds.push(kind);
    if (end === text.length) break;
    start = end + 1;
  }
  return kinds;
}

/**
 * Folding ranges that hide runs of code-only lines (blank lines inside a run
 * go with it). A range starts on the line above the run, which stays in view,
 * since VS Code always shows a folded range's first line. Lines in `keepOpen`
 * (the cursor's) stay in view: a run is split around them.
 */
export function codeRuns(kinds: LineKind[], keepOpen: Set<number>): [number, number][] {
  const out: [number, number][] = [];
  const push = (first: number, last: number) => {
    // Trim blank lines at the ends of a piece.
    while (first <= last && kinds[first] === "blank") first++;
    while (last >= first && kinds[last] === "blank") last--;
    if (first > last) return;
    const start = first === 0 ? 0 : first - 1;
    if (last > start) out.push([start, last]);
  };
  let i = 0;
  while (i < kinds.length) {
    if (kinds[i] !== "code") {
      i++;
      continue;
    }
    let last = i;
    let j = i;
    while (j < kinds.length && kinds[j] !== "text") {
      if (kinds[j] === "code") last = j;
      j++;
    }
    let from = i;
    for (let l = i; l <= last; l++) {
      if (keepOpen.has(l)) {
        push(from, l - 1);
        from = l + 1;
      }
    }
    push(from, last);
    i = j;
  }
  return out;
}
