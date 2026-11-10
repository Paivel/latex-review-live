/** What is kept beside a document in .latex-review/<name>.json. Pure data, no vscode. */

export interface StoredComment {
  id: string;
  author: string;
  body: string;
  created: string;
  edited?: string;
}

export interface StoredThread {
  id: string;
  /** Offsets in the current document text. */
  start: number;
  end: number;
  /** The text the thread was on, to find it again after outside edits. */
  quote: string;
  resolved: boolean;
  comments: StoredComment[];
}

export interface ReviewFile {
  version: 1;
  /** The text changes are measured against; absent when changes are not tracked. */
  baseline?: string;
  trackingSince?: string;
  threads: StoredThread[];
}

export function emptyReview(): ReviewFile {
  return { version: 1, threads: [] };
}

export function parseReview(json: string): ReviewFile {
  const data = JSON.parse(json);
  if (!data || typeof data !== "object") return emptyReview();
  const threads: StoredThread[] = Array.isArray(data.threads)
    ? data.threads
        .filter((t: any) => t && typeof t.start === "number" && typeof t.end === "number" && Array.isArray(t.comments))
        .map((t: any) => ({
          id: String(t.id ?? newId()),
          start: t.start,
          end: t.end,
          quote: typeof t.quote === "string" ? t.quote : "",
          resolved: !!t.resolved,
          comments: t.comments
            .filter((c: any) => c && typeof c.body === "string")
            .map((c: any) => ({
              id: String(c.id ?? newId()),
              author: String(c.author ?? ""),
              body: c.body,
              created: String(c.created ?? ""),
              ...(c.edited ? { edited: String(c.edited) } : {}),
            })),
        }))
    : [];
  return {
    version: 1,
    ...(typeof data.baseline === "string" ? { baseline: data.baseline } : {}),
    ...(typeof data.trackingSince === "string" ? { trackingSince: data.trackingSince } : {}),
    threads,
  };
}

export function serializeReview(r: ReviewFile): string {
  return JSON.stringify(r, null, 2) + "\n";
}

export function isEmptyReview(r: ReviewFile): boolean {
  return r.baseline === undefined && r.threads.length === 0;
}

let counter = 0;
export function newId(): string {
  counter = (counter + 1) % 1e6;
  return Date.now().toString(36) + "-" + counter.toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * Move an anchored range [start, end) across one text edit that replaced
 * [editStart, editEnd) with text of length newLen.
 */
export function shiftRange(start: number, end: number, editStart: number, editEnd: number, newLen: number): [number, number] {
  const delta = newLen - (editEnd - editStart);
  const map = (pos: number, isEnd: boolean): number => {
    if (pos < editStart) return pos;
    if (pos > editEnd) return pos + delta;
    if (pos === editStart && pos === editEnd) {
      // Insertion exactly at the boundary: the start stays, the end does not grow.
      return pos;
    }
    if (pos === editStart) return pos;
    // Inside the replaced text: stick to its end (for the end) or start (for the start).
    return isEnd ? editStart + newLen : editStart;
  };
  let s = map(start, false);
  let e = map(end, true);
  if (start === end) {
    s = e = map(start, false);
  }
  if (e < s) e = s;
  return [s, e];
}

/**
 * Find a thread's range again in text changed outside the editor:
 * keep it if the quote is still there, else take the occurrence of the quote
 * nearest to where it was, else clamp.
 */
export function reanchor(text: string, start: number, end: number, quote: string): [number, number] {
  if (text.slice(start, end) === quote) return [start, end];
  if (quote.length > 0) {
    let best = -1;
    let i = text.indexOf(quote);
    while (i !== -1) {
      if (best === -1 || Math.abs(i - start) < Math.abs(best - start)) best = i;
      i = text.indexOf(quote, i + 1);
    }
    if (best !== -1) return [best, best + quote.length];
  }
  const s = Math.min(start, text.length);
  return [s, Math.min(Math.max(end, s), text.length)];
}
