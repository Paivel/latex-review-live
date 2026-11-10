/** Where text may be edited in live preview: between \begin{document}'s line and \end{document}. */
export function bodyBounds(text: string): [number, number] | undefined {
  const b = /\\begin\s*\{document\}[^\n]*\n?/.exec(text);
  if (!b) return undefined;
  const from = b.index + b[0].length;
  const e = /\\end\s*\{document\}/.exec(text.slice(from));
  return [from, e ? from + e.index : text.length];
}

export interface Edit {
  rangeOffset: number;
  rangeLength: number;
  text: string;
}

/**
 * The edits that undo those touching the preamble or what follows
 * \end{document}, as ranges of the new text with the old text to put back.
 * byUser tells typing from edits made by other extensions (such as a figure
 * paste adding its \usepackage lines), which are left alone.
 */
export function revertsOutsideBody(oldText: string, changes: readonly Edit[], byUser: (c: Edit) => boolean = () => true): { start: number; end: number; text: string }[] {
  const bounds = bodyBounds(oldText);
  if (!bounds) return [];
  const [from, to] = bounds;
  const sorted = [...changes].sort((a, b) => a.rangeOffset - b.rangeOffset);
  const out: { start: number; end: number; text: string }[] = [];
  let shift = 0;
  for (const c of sorted) {
    const outside = (c.rangeOffset < from || c.rangeOffset + c.rangeLength > to) && byUser(c);
    const start = c.rangeOffset + shift;
    if (outside) out.push({ start, end: start + c.text.length, text: oldText.slice(c.rangeOffset, c.rangeOffset + c.rangeLength) });
    shift += c.text.length - c.rangeLength;
  }
  return out;
}

/** The edits that undo the changes `bad` picks, as ranges of the new text with the old text to put back. */
export function revertsWhere(oldText: string, changes: readonly Edit[], bad: (c: Edit) => boolean): { start: number; end: number; text: string }[] {
  const sorted = [...changes].sort((a, b) => a.rangeOffset - b.rangeOffset);
  const out: { start: number; end: number; text: string }[] = [];
  let shift = 0;
  for (const c of sorted) {
    const start = c.rangeOffset + shift;
    if (bad(c)) out.push({ start, end: start + c.text.length, text: oldText.slice(c.rangeOffset, c.rangeOffset + c.rangeLength) });
    shift += c.text.length - c.rangeLength;
  }
  return out;
}

/** Sorted, with touching or overlapping ranges joined. */
export function mergeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = ranges.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** A cursor that lands inside hidden code moves out of it, on the side it was heading for. */
export function snapOffset(offset: number, previous: number | undefined, hidden: [number, number][]): number {
  for (const [a, b] of hidden) {
    if (a < offset && offset < b) return previous !== undefined && previous > offset ? a : b;
    if (a >= offset) break;
  }
  return offset;
}

/** Whether an edit cuts into hidden code (typing inside it, or deleting part of it) rather than leaving it whole. */
export function cutsHidden(c: Edit, hidden: [number, number][]): boolean {
  const a = c.rangeOffset;
  const b = c.rangeOffset + c.rangeLength;
  for (const [s, e] of hidden) {
    if (s > b) break;
    if (a === b) {
      if (s < a && a < e) return true;
      continue;
    }
    const overlaps = a < e && b > s;
    const whole = a <= s && b >= e;
    if (overlaps && !whole) return true;
  }
  return false;
}
