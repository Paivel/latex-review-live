import * as vscode from "vscode";
import * as path from "path";
import { appendText, bibTargets, citeKeys, missingKeys } from "./keys";
import { exportEntry, NotInZotero, ZoteroUnavailable } from "./zotero";

/**
 * Keeps the document's .bib file in sync with its \cite keys by pulling
 * missing entries from Zotero (Better BibTeX) on save and while typing.
 */
export class AutoBib implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private timers = new Map<string, NodeJS.Timeout>();
  private lastKeys = new Map<string, string>();
  private notFound = new Set<string>();
  private running = new Map<string, Promise<void>>();
  private warnedOffline = false;
  private status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);

  constructor() {
    this.disposables.push(
      this.status,
      vscode.workspace.onDidSaveTextDocument((d) => {
        if (!this.enabled(d)) return;
        this.notFound.clear();
        this.schedule(d, 0);
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (!this.enabled(e.document)) return;
        const keys = citeKeys(e.document.getText()).join(",");
        if (keys === this.lastKeys.get(e.document.uri.toString())) return;
        this.schedule(e.document, 1500);
      }),
      vscode.workspace.onDidOpenTextDocument((d) => this.enabled(d) && this.schedule(d, 500)),
      vscode.commands.registerCommand("latexReview.updateBibliography", async () => {
        const d = vscode.window.activeTextEditor?.document;
        if (!d || d.languageId !== "latex") return void vscode.window.showInformationMessage("Open a LaTeX file first.");
        this.notFound.clear();
        this.warnedOffline = false;
        const added = await this.sync(d, true);
        if (added !== undefined) vscode.window.showInformationMessage(added ? `Added ${added} entr${added === 1 ? "y" : "ies"} from Zotero.` : "Bibliography is up to date.");
      }),
    );
    for (const d of vscode.workspace.textDocuments) if (this.enabled(d)) this.schedule(d, 1000);
  }

  private enabled(d: vscode.TextDocument) {
    return d.languageId === "latex" && d.uri.scheme === "file" && vscode.workspace.getConfiguration("latexReview.zotero", d.uri).get("autoBibliography", true);
  }

  private schedule(d: vscode.TextDocument, delay: number) {
    const id = d.uri.toString();
    clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(() => { this.timers.delete(id); void this.sync(d, false); }, delay));
  }

  /** Returns the number of entries added, or undefined when nothing could be done. */
  private async sync(d: vscode.TextDocument, verbose: boolean): Promise<number | undefined> {
    const id = d.uri.toString();
    const prev = this.running.get(id);
    if (prev) await prev;
    let result: number | undefined;
    const job = this.run(d, verbose).then((n) => { result = n; });
    this.running.set(id, job);
    try { await job; } finally { if (this.running.get(id) === job) this.running.delete(id); }
    return result;
  }

  private async run(d: vscode.TextDocument, verbose: boolean): Promise<number | undefined> {
    const text = d.getText();
    const cited = citeKeys(text);
    this.lastKeys.set(d.uri.toString(), cited.join(","));
    const targets = bibTargets(text);
    if (!targets.length) {
      if (verbose && cited.length) vscode.window.showWarningMessage("Add \\bibliography{refs} to the document so citations have a .bib file.");
      return verbose ? undefined : 0;
    }
    const dir = path.dirname(d.uri.fsPath);
    const files = targets.map((t) => vscode.Uri.file(path.resolve(dir, t.file)));
    const texts = await Promise.all(files.map((u) => readText(u)));
    const missing = missingKeys(cited, texts.map((t) => t ?? "")).filter((k) => !this.notFound.has(k));
    if (!missing.length) return 0;

    const cfg = vscode.workspace.getConfiguration("latexReview.zotero", d.uri);
    const server = cfg.get<string>("server", "http://127.0.0.1:23119");
    const translator = targets[0].kind === "biblatex" ? "Better BibLaTeX" : "Better BibTeX";
    const entries: string[] = [];
    const absent: string[] = [];
    for (const key of missing) {
      try {
        entries.push(await exportEntry(server, key, translator));
      } catch (e) {
        if (e instanceof NotInZotero) { absent.push(key); this.notFound.add(key); continue; }
        if (e instanceof ZoteroUnavailable) {
          if (verbose || !this.warnedOffline) {
            this.warnedOffline = true;
            vscode.window.showWarningMessage(`Zotero is not running, so ${missing.length} citation${missing.length === 1 ? "" : "s"} could not be added to ${targets[0].file}. Start Zotero (with Better BibTeX) and save again.`);
          }
          return undefined;
        }
        vscode.window.showWarningMessage(`Zotero: ${(e as Error).message}`);
      }
    }
    if (absent.length) vscode.window.showWarningMessage(`Not found in Zotero: ${absent.join(", ")}`);
    if (!entries.length) return 0;

    // Re-read right before writing so a concurrent edit is not lost.
    const current = (await readText(files[0])) ?? "";
    const add = appendText(current, entries.join("\n\n"));
    await vscode.workspace.fs.writeFile(files[0], Buffer.from(current + add, "utf8"));
    this.status.text = `$(book) Added ${entries.length} to ${targets[0].file}`;
    this.status.show();
    setTimeout(() => this.status.hide(), 5000);
    return entries.length;
  }

  dispose() {
    for (const t of this.timers.values()) clearTimeout(t);
    vscode.Disposable.from(...this.disposables).dispose();
  }
}

async function readText(u: vscode.Uri): Promise<string | undefined> {
  try {
    const open = vscode.workspace.textDocuments.find((t) => t.uri.toString() === u.toString());
    if (open) return open.getText();
    return Buffer.from(await vscode.workspace.fs.readFile(u)).toString("utf8");
  } catch {
    return undefined;
  }
}
