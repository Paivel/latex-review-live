// The real PDF for the visual editor's PDF view: latexmk on a copy of the editor's text, then SyncTeX for clicks.
// Works the same with TeX Live and MiKTeX on macOS, Windows and Linux; nothing here is platform-only.
import * as fs from "fs";
import * as path from "path";
import { execFile, ChildProcess } from "child_process";

export interface LiveStatus {
  state: "building" | "ok" | "error" | "missing";
  text: string;
}

/** Folders TeX distributions install into but a GUI-launched editor may not have on PATH. */
function texPath(): string {
  const extra = process.platform === "win32"
    ? [] // MiKTeX and TeX Live put themselves on PATH on Windows.
    : ["/Library/TeX/texbin", "/usr/texbin", "/opt/homebrew/bin", "/usr/local/bin", ...texliveBins()];
  return [process.env.PATH ?? "", ...extra].filter(Boolean).join(path.delimiter);
}

function texliveBins(): string[] {
  const root = "/usr/local/texlive";
  try {
    return fs.readdirSync(root).filter((y) => /^\d{4}/.test(y)).sort().reverse().flatMap((y) => {
      try { return fs.readdirSync(path.join(root, y, "bin")).map((a) => path.join(root, y, "bin", a)); } catch { return []; }
    });
  } catch { return []; }
}

/** latexmk's engine switch from a "% !TEX program = xelatex" line, else pdflatex. */
export function engineFlag(text: string): string {
  const m = /^%\s*!TEX\s+(?:TS-)?program\s*=\s*(\w+)/im.exec(text.slice(0, 2000));
  const p = m?.[1].toLowerCase();
  return p === "xelatex" ? "-xelatex" : p === "lualatex" ? "-lualatex" : "-pdf";
}

/** The first "file:line: message" errors of a -file-line-error log. */
export function logErrors(log: string): string[] {
  const out: string[] = [];
  for (const m of log.matchAll(/^(?:[^\n:]*[\\/])?([^\\/\n:]+\.tex):(\d+): (.+)$/gm)) {
    out.push(`line ${m[2]}: ${m[3].trim()}`);
    if (out.length >= 3) break;
  }
  if (!out.length) for (const m of log.matchAll(/^! (.+)$/gm)) { out.push(m[1]); if (out.length >= 3) break; }
  return out;
}

/** "Input:..." and "Line:..." of `synctex edit` output: the first record. */
export function parseSynctexEdit(out: string): { input: string; line: number } | null {
  const input = /^Input:(.+)$/m.exec(out)?.[1].trim();
  const line = Number(/^Line:(\d+)$/m.exec(out)?.[1]);
  return input && line > 0 ? { input, line } : null;
}

export const NO_CHANGES_PKG = "Tracked changes are not shown: install the LaTeX package 'changes' (tlmgr install changes, or the MiKTeX console).";

/** The log of a run that stopped because changes.sty is not installed. */
export function missingChanges(log: string): boolean {
  return /File `changes\.sty' not found/.test(log);
}

export class LivePdf {
  private timer: NodeJS.Timeout | undefined;
  private proc: ChildProcess | undefined;
  private again = false;
  private disposed = false;
  /** False once a build showed the changes package is not installed: tracked changes are then left out. */
  private marks = true;
  readonly dir: string;
  readonly outDir: string;
  readonly copy: string;

  constructor(
    private texFile: string,
    /** The text to build; with marks, tracked changes as changes-package markup on the same lines. */
    private text: (marks: boolean) => string,
    private onPdf: (pdf: Buffer) => void,
    private onStatus: (s: LiveStatus) => void,
  ) {
    this.dir = path.dirname(texFile);
    this.outDir = path.join(this.dir, ".latex-review", "live");
    this.copy = path.join(this.outDir, path.basename(texFile));
  }

  get pdf(): string {
    return this.copy.replace(/\.tex$/i, "") + ".pdf";
  }

  /** Build after a pause in typing. */
  schedule(delay = 1200) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.build(), delay);
  }

  private build() {
    if (this.disposed) return;
    if (this.proc) { this.again = true; return; }
    fs.mkdirSync(this.outDir, { recursive: true });
    const marked = this.marks;
    const text = this.text(marked);
    fs.writeFileSync(this.copy, text);
    // A bibliography made by an earlier build beside the file is used until latexmk makes its own.
    const bbl = path.basename(this.copy).replace(/\.tex$/i, ".bbl");
    if (!fs.existsSync(path.join(this.outDir, bbl)) && fs.existsSync(path.join(this.dir, bbl))) fs.copyFileSync(path.join(this.dir, bbl), path.join(this.outDir, bbl));
    // TeX runs in the document's folder, so \input, \includegraphics and .bib files resolve as in a normal build;
    // only the output goes to .latex-review/live.
    const env = { ...process.env, PATH: texPath(), TEXINPUTS: this.dir + path.delimiter, BIBINPUTS: this.dir + path.delimiter, BSTINPUTS: this.dir + path.delimiter };
    const rel = path.relative(this.dir, this.copy);
    const args = [engineFlag(text), "-synctex=1", "-interaction=nonstopmode", "-file-line-error", `-outdir=${path.relative(this.dir, this.outDir)}`, rel];
    this.onStatus({ state: "building", text: "Building PDF…" });
    const before = this.mtime();
    this.proc = execFile("latexmk", args, { cwd: this.dir, env, timeout: 120000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      this.proc = undefined;
      if (this.disposed) return;
      const missing = (err as NodeJS.ErrnoException | null)?.code === "ENOENT";
      if (missing) {
        this.onStatus({ state: "missing", text: "latexmk was not found. Install TeX Live or MiKTeX (with Perl for latexmk on Windows)." });
        return;
      }
      const after = this.mtime();
      if (after && after !== before) {
        try { this.onPdf(fs.readFileSync(this.pdf)); } catch { /* removed meanwhile */ }
      }
      if (err) {
        let log = `${stdout}\n${stderr}`;
        try { log = fs.readFileSync(this.copy.replace(/\.tex$/i, ".log"), "utf8"); } catch { /* none */ }
        if (marked && missingChanges(log)) {
          // TeX Live basic and a fresh MiKTeX may lack the package; show the PDF without the marks rather than none.
          this.marks = false;
          this.build();
          return;
        }
        const errs = logErrors(log);
        this.onStatus({ state: "error", text: errs.length ? errs.join(" · ") : "The build failed; see the log in .latex-review/live." });
      } else this.onStatus({ state: "ok", text: marked ? "" : NO_CHANGES_PKG });
      if (this.again) { this.again = false; this.build(); }
    });
  }

  private mtime(): number {
    try { return fs.statSync(this.pdf).mtimeMs; } catch { return 0; }
  }

  /** The current PDF, if a build made one. */
  current(): Buffer | undefined {
    try { return fs.readFileSync(this.pdf); } catch { return undefined; }
  }

  /** The source line under a point of the PDF (page from 1, x and y in pt from the top left). */
  where(pageNo: number, x: number, y: number): Promise<{ file: string; line: number } | null> {
    return new Promise((resolve) => {
      execFile("synctex", ["edit", "-o", `${pageNo}:${x.toFixed(2)}:${y.toFixed(2)}:${this.pdf}`, "-d", this.outDir], { cwd: this.dir, env: { ...process.env, PATH: texPath() }, timeout: 10000 }, (err, stdout) => {
        if (err) return resolve(null);
        const r = parseSynctexEdit(stdout);
        if (!r) return resolve(null);
        const file = path.resolve(this.dir, r.input);
        // The copy stands for the document itself.
        resolve({ file: path.normalize(file) === path.normalize(this.copy) ? this.texFile : file, line: r.line });
      });
    });
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.proc?.kill();
  }
}
