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
