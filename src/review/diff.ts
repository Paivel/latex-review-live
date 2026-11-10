import { diffWordsWithSpace } from "diff";

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

  const parts = diffWordsWithSpace(a, b, { timeout: timeoutMs });
  if (!parts) {
    return [{ baseStart: pre, baseEnd: pre + a.length, curStart: pre, curEnd: pre + b.length, deleted: a, inserted: b }];
  }

  const raw: Change[] = [];
  let bi = pre;
  let ci = pre;
  let open: Change | undefined;
  for (const p of parts) {
    if (!p.added && !p.removed) {
      if (open) {
        raw.push(open);
        open = undefined;
      }
      bi += p.value.length;
      ci += p.value.length;
      continue;
    }
    if (!open) open = { baseStart: bi, baseEnd: bi, curStart: ci, curEnd: ci, deleted: "", inserted: "" };
    if (p.removed) {
      open.deleted += p.value;
      bi += p.value.length;
      open.baseEnd = bi;
    } else {
      open.inserted += p.value;
      ci += p.value.length;
      open.curEnd = ci;
    }
  }
  if (open) raw.push(open);

  // Merge changes split by a short run of spaces on the same line.
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
