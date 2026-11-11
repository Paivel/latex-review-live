// Pure helpers for finding citation keys and bibliography files in LaTeX sources.

/** Strip unescaped % comments, keeping line structure. */
export function stripComments(tex: string): string {
  return tex.replace(/(^|[^\\])%.*$/gm, "$1");
}

const CITE = /\\(?:[a-zA-Z]*cite[a-zA-Z]*|nocite)\*?\s*(?:\[[^\]]*\]\s*){0,2}\{([^}]*)\}/g;

/** Citation keys used by \cite-like commands, in order of first use. */
export function citeKeys(tex: string): string[] {
  const out = new Set<string>();
  for (const m of stripComments(tex).matchAll(CITE)) {
    for (const k of m[1].split(",")) {
      // mciteplus: "*key" joins the previous reference into one item; the key itself has no star.
      const key = k.trim().replace(/^\*/, "");
      if (key) out.add(key);
    }
  }
  return [...out];
}

export interface BibTarget {
  /** Path as written in the document, always ending with .bib. */
  file: string;
  /** "bibtex" for \bibliography, "biblatex" for \addbibresource. */
  kind: "bibtex" | "biblatex";
}

/** Bibliography files named in the document. */
export function bibTargets(tex: string): BibTarget[] {
  const src = stripComments(tex);
  const out: BibTarget[] = [];
  for (const m of src.matchAll(/\\bibliography\s*\{([^}]*)\}/g)) {
    for (const f of m[1].split(",")) {
      const name = f.trim();
      if (name) out.push({ file: name.endsWith(".bib") ? name : name + ".bib", kind: "bibtex" });
    }
  }
  for (const m of src.matchAll(/\\addbibresource\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g)) {
    const name = m[1].trim();
    if (name && !/^https?:/.test(name)) out.push({ file: name.endsWith(".bib") ? name : name + ".bib", kind: "biblatex" });
  }
  return out;
}

/** Entry keys defined in a .bib file. */
export function bibKeys(bib: string): Set<string> {
  const out = new Set<string>();
  for (const m of bib.matchAll(/@\s*([a-zA-Z]+)\s*[{(]\s*([^,\s]+)\s*,/g)) {
    if (!/^(comment|string|preamble)$/i.test(m[1])) out.add(m[2]);
  }
  return out;
}

/** Keys cited but not defined in any of the given bib texts. */
export function missingKeys(cited: string[], bibs: string[]): string[] {
  const have = new Set<string>();
  for (const b of bibs) for (const k of bibKeys(b)) have.add(k);
  return cited.filter((k) => !have.has(k));
}

/** Text to append to an existing bib file so that entries stay separated. */
export function appendText(existing: string, entries: string): string {
  const body = entries.trim();
  if (!body) return "";
  if (!existing) return body + "\n";
  const sep = existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  return sep + body + "\n";
}
