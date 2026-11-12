import { diffLines, diffWordsWithSpace } from "diff";

/**
 * One tracked change: the text between baseStart..baseEnd of the baseline
 * became the text between curStart..curEnd of the current document.
 * A pure insertion has baseStart == baseEnd, a pure deletion curStart == curEnd.
 */
export interface Change {
  baseStart: number;
  baseEnd: number;
  curStart: number;
  curEnd: number;
  deleted: string;
  inserted: string;
}

export type ChangeKind = "insert" | "delete" | "replace";

export function kindOf(c: Change): ChangeKind {
  if (c.deleted === "") return "insert";
  if (c.inserted === "") return "delete";
  return "replace";
}

const isSpace = (ch: string) => ch === " " || ch === "\t" || ch === "\n" || ch === "\r";

/** Common prefix length, backed off to the last whitespace so no word is split. */
function commonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  if (i === a.length && i === b.length) return i;
  while (i > 0 && !isSpace(a[i - 1])) i--;
  return i;
}

function commonSuffix(a: string, b: string, prefix: number): number {
  const n = Math.min(a.length, b.length) - prefix;
  let i = 0;
  while (i < n && a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)) i++;
  while (i > 0 && !isSpace(a[a.length - i])) i--;
  return i;
}

/**
 * Word-level changes between the baseline and the current text.
 * Neighbouring edits separated only by spaces on one line are merged,
 * so rewriting "big red dog" into "small blue cat" is one change.
 */
export function computeChanges(base: string, cur: string, timeoutMs = 1500): Change[] {
  if (base === cur) return [];
  const pre = commonPrefix(base, cur);
  const suf = commonSuffix(base, cur, pre);
  const a = base.slice(pre, base.length - suf);
  const b = cur.slice(pre, cur.length - suf);

  // Lines first, then words only inside lines that were rewritten. Whole lines that went or came (a figure moved
  // elsewhere, a paragraph added) stay one block instead of being matched word by word with their neighbours,
  // where "\\end{" of one environment would pair with "\\end{" of another.
  const lines = diffLines(a, b, { timeout: timeoutMs });
  if (!lines) {
    return [{ baseStart: pre, baseEnd: pre + a.length, curStart: pre, curEnd: pre + b.length, deleted: a, inserted: b }];
  }
  const raw: Change[] = [];
  let bi = pre;
  let ci = pre;
  let del = "";
  let ins = "";
  const flush = () => {
    if (del && ins) {
      const words = wordChanges(del, ins, bi - del.length, ci - ins.length, timeoutMs);
      if (words) raw.push(...words);
      else raw.push({ baseStart: bi - del.length, baseEnd: bi, curStart: ci - ins.length, curEnd: ci, deleted: del, inserted: ins });
    } else if (del || ins) raw.push({ baseStart: bi - del.length, baseEnd: bi, curStart: ci - ins.length, curEnd: ci, deleted: del, inserted: ins });
    del = "";
    ins = "";
  };
  for (const p of lines) {
    if (p.removed) { del += p.value; bi += p.value.length; }
    else if (p.added) { ins += p.value; ci += p.value.length; }
    else { flush(); bi += p.value.length; ci += p.value.length; }
  }
  flush();
  return mergeNear(raw, base, cur);
}

/** Merge changes split by a short run of spaces on the same line. */
/** Word-level changes between two pieces of text that start at bi (baseline) and ci (current). */
function wordChanges(a: string, b: string, bi: number, ci: number, timeoutMs: number): Change[] | null {
  const parts = diffWordsWithSpace(a, b, { timeout: timeoutMs });
  if (!parts) return null;
  const raw: Change[] = [];
  let open: Change | undefined;
  for (const p of parts) {
    if (!p.added && !p.removed) {
      if (open) { raw.push(open); open = undefined; }
      bi += p.value.length;
      ci += p.value.length;
      continue;
    }
    if (!open) open = { baseStart: bi, baseEnd: bi, curStart: ci, curEnd: ci, deleted: "", inserted: "" };
    if (p.removed) { open.deleted += p.value; bi += p.value.length; open.baseEnd = bi; }
    else { open.inserted += p.value; ci += p.value.length; open.curEnd = ci; }
  }
  if (open) raw.push(open);
  return raw;
}

function mergeNear(raw: Change[], base: string, cur: string): Change[] {
  const merged: Change[] = [];
  for (const c of raw) {
    const last = merged[merged.length - 1];
    if (last) {
      const gap = cur.slice(last.curEnd, c.curStart);
      if (gap.length > 0 && gap.length <= 2 && /^[ \t]+$/.test(gap) && last.deleted !== "" && c.deleted !== "" && last.inserted !== "" && c.inserted !== "") {
        last.deleted = base.slice(last.baseStart, c.baseEnd);
        last.inserted = cur.slice(last.curStart, c.curEnd);
        last.baseEnd = c.baseEnd;
        last.curEnd = c.curEnd;
        continue;
      }
    }
    merged.push({ ...c });
  }
  return merged;
}

/**
 * A run that the baseline and the current text share: base[b, b+len) === cur[c, c+len).
 * Keeping these across edits is what stops a deletion from jumping: a fresh diff
 * of the whole text may align a blank line or a repeated word with a different
 * copy and so show the deleted text somewhere else.
 */
export interface Seg {
  b: number;
  c: number;
  len: number;
}

/** The shared runs between the changes. */
export function segsOf(base: string, cur: string, changes: Change[]): Seg[] {
  const out: Seg[] = [];
  let b = 0;
  let c = 0;
  for (const ch of changes) {
    if (ch.baseStart > b) out.push({ b, c, len: ch.baseStart - b });
    b = ch.baseEnd;
    c = ch.curEnd;
  }
  if (base.length > b) out.push({ b, c, len: base.length - b });
  return out;
}

/** Runs after replacing [start, end) on one side by `newLen` characters: cut where they overlap, shift after. */
export function editSegs(segs: Seg[], side: "b" | "c", start: number, end: number, newLen: number): Seg[] {
  const delta = newLen - (end - start);
  const other = side === "b" ? "c" : "b";
  const out: Seg[] = [];
  for (const s of segs) {
    const a = s[side];
    const z = a + s.len;
    if (z <= start) {
      out.push(s);
      continue;
    }
    if (a >= end) {
      out.push({ ...s, [side]: a + delta } as Seg);
      continue;
    }
    if (a < start) out.push({ ...s, len: start - a });
    if (z > end) {
      const cut = end - a;
      out.push({ [side]: end + delta, [other]: s[other] + cut, len: z - end } as unknown as Seg);
    }
  }
  return out;
}

/** The runs still hold for these texts. */
export function segsValid(base: string, cur: string, segs: Seg[]): boolean {
  let b = 0;
  let c = 0;
  for (const s of segs) {
    if (s.len <= 0 || s.b < b || s.c < c || s.b + s.len > base.length || s.c + s.len > cur.length) return false;
    if (base.slice(s.b, s.b + s.len) !== cur.slice(s.c, s.c + s.len)) return false;
    b = s.b + s.len;
    c = s.c + s.len;
  }
  return true;
}

/**
 * Changes when the shared runs are known: only the text between runs is diffed.
 * A run cut inside a word gives that word back to the gap, so changes stay whole words.
 */
export function changesBetween(base: string, cur: string, segs: Seg[], timeoutMs = 1500): Change[] {
  // Join touching runs.
  let runs: Seg[] = [];
  for (const s of segs) {
    const last = runs[runs.length - 1];
    if (last && last.b + last.len === s.b && last.c + last.len === s.c) last.len += s.len;
    else if (s.len > 0) runs.push({ ...s });
  }
  const word = (t: string, i: number) => i >= 0 && i < t.length && !isSpace(t[i]);
  for (let changed = true; changed; ) {
    changed = false;
    const next: Seg[] = [];
    for (let k = 0; k < runs.length; k++) {
      const s = { ...runs[k] };
      const prev = next[next.length - 1];
      const pb = prev ? prev.b + prev.len : 0;
      const pc = prev ? prev.c + prev.len : 0;
      // A gap before this run that ends in a word, while the run starts mid-word.
      if ((s.b > pb && word(base, s.b - 1)) || (s.c > pc && word(cur, s.c - 1))) {
        while (s.len > 0 && word(cur, s.c)) { s.b++; s.c++; s.len--; changed = true; }
      }
      const nb = k + 1 < runs.length ? runs[k + 1].b : base.length;
      const nc = k + 1 < runs.length ? runs[k + 1].c : cur.length;
      const eb = s.b + s.len;
      const ec = s.c + s.len;
      if ((nb > eb && word(base, eb)) || (nc > ec && word(cur, ec))) {
        while (s.len > 0 && word(cur, s.c + s.len - 1)) { s.len--; changed = true; }
      }
      if (s.len > 0) next.push(s);
      else changed = true;
    }
    runs = next;
  }
  const raw: Change[] = [];
  let b = 0;
  let c = 0;
  const gap = (be: number, ce: number) => {
    if (be > b || ce > c) {
      for (const ch of computeChanges(base.slice(b, be), cur.slice(c, ce), timeoutMs)) {
        raw.push({ ...ch, baseStart: ch.baseStart + b, baseEnd: ch.baseEnd + b, curStart: ch.curStart + c, curEnd: ch.curEnd + c });
      }
    }
  };
  for (const s of runs) {
    gap(s.b, s.c);
    b = s.b + s.len;
    c = s.c + s.len;
  }
  gap(base.length, cur.length);
  return mergeNear(raw, base, cur);
}

/** The baseline after accepting one change: it now reads like the current text there. */
export function acceptInBase(base: string, c: Change): string {
  return base.slice(0, c.baseStart) + c.inserted + base.slice(c.baseEnd);
}

/** Baseline after accepting all changes is simply the current text. */
export function acceptAll(_base: string, cur: string): string {
  return cur;
}

/** Current text after rejecting several changes (any order). */
export function rejectInCurrent(cur: string, changes: Change[]): string {
  const sorted = [...changes].sort((x, y) => y.curStart - x.curStart);
  let out = cur;
  for (const c of sorted) out = out.slice(0, c.curStart) + c.deleted + out.slice(c.curEnd);
  return out;
}

/** The change whose current range holds or touches the offset. */
export function changeAt(changes: Change[], offset: number): Change | undefined {
  return changes.find((c) => offset >= c.curStart && offset <= c.curEnd);
}
