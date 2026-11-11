// Cmd+B / Cmd+I / Cmd+U in a .tex editor: wrap the selection in \textbf{..}, \textit{..} or \underline{..}, or take it out again.
import { groupEnd } from "../visual/inline";

export interface WrapEdit {
  /** Replace start..end of the text by `text`, then select selStart..selEnd (offsets in the new text). */
  start: number;
  end: number;
  text: string;
  selStart: number;
  selEnd: number;
}

/** The \cmd{..} group around start..end, if any: [command start, brace end]. */
function around(text: string, cmd: string, start: number, end: number): [number, number] | null {
  const open = `\\${cmd}{`;
  let k = text.lastIndexOf(open, start);
  while (k >= 0) {
    const e = groupEnd(text, k + open.length - 1);
    if (e > 0 && k + open.length <= start && e - 1 >= end) return [k, e];
    k = k > 0 ? text.lastIndexOf(open, k - 1) : -1;
  }
  return null;
}

export function toggleWrap(text: string, cmd: string, start: number, end: number): WrapEdit {
  const open = `\\${cmd}{`;
  const sel = text.slice(start, end);
  // The selection is a whole \cmd{..}: unwrap it.
  if (sel.startsWith(open) && sel.endsWith("}") && groupEnd(text, start + open.length - 1) === end) {
    const inner = sel.slice(open.length, -1);
    return { start, end, text: inner, selStart: start, selEnd: start + inner.length };
  }
  // The selection (or the caret) is inside a \cmd{..}: unwrap that.
  const g = around(text, cmd, start, end);
  if (g) {
    const inner = text.slice(g[0] + open.length, g[1] - 1);
    return { start: g[0], end: g[1], text: inner, selStart: start - open.length, selEnd: end - open.length };
  }
  return { start, end, text: open + sel + "}", selStart: start + open.length, selEnd: end + open.length };
}
