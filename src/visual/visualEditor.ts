import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { applyOwnEdit } from "../own-edits";
import { ReviewStore } from "../review/review";
import { readAux } from "../preview/aux";
import { TEXT_SYMBOLS } from "../preview/symbols";
import { fieldEdit, figureAt, graphicsPaths, imageCandidates } from "./figure";
import { VDoc, VImage, buildDoc } from "./model";
import { parseBbl } from "./bbl";
import { pdfSize, reactioLabels } from "./figureFiles";
import { execFile } from "child_process";
import * as crypto from "crypto";

type FromPage =
  | { type: "ready" }
  | { type: "edit"; start: number; end: number; old: string; text: string }
  | { type: "field"; fig: number; which: "caption" | "label"; value: string }
  | { type: "join"; start: number; end: number }
  | { type: "jump"; offset: number; length: number }
  | { type: "reveal"; offset: number }
  | { type: "decide"; accept: boolean; curStart: number; curEnd: number }
  | { type: "source" }
  | { type: "editFigure"; file: string; entry?: string };

/**
 * The visual editor: the document drawn like the PDF, in a tab beside the
 * source, where text, headings, captions and labels are edited in place.
 */
export class VisualEditor implements vscode.Disposable {
  private panels = new Map<string, Panel>();
  private disposables: vscode.Disposable[] = [];

  constructor(private store: ReviewStore, private extensionUri: vscode.Uri, private storage: vscode.Uri) {
    this.disposables.push(
      vscode.commands.registerCommand("latexReview.openVisualEditor", (uri?: vscode.Uri) => this.open(uri)),
      vscode.workspace.onDidChangeTextDocument((e) => this.panels.get(e.document.uri.toString())?.schedule(60)),
      vscode.workspace.onDidSaveTextDocument((d) => this.panels.get(d.uri.toString())?.schedule(300)),
      store.onDidChange((r) => this.panels.get(r.uri.toString())?.schedule(30)),
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (e.kind === vscode.TextEditorSelectionChangeKind.Command) return;
        this.panels.get(e.textEditor.document.uri.toString())?.cursor(e.textEditor.document.offsetAt(e.selections[0].active));
      }),
    );
    // Pictures change when Reactio Draw saves a drawing or LaTeX writes the .aux.
    const w = vscode.workspace.createFileSystemWatcher("**/*.{pdf,png,jpg,jpeg,svg,aux}");
    const all = () => this.panels.forEach((p) => p.schedule(400, true));
    this.disposables.push(w, w.onDidChange(all), w.onDidCreate(all));
  }

  private async open(uri?: vscode.Uri) {
    const doc = uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor?.document;
    if (!doc || !/^(latex|tex)$/.test(doc.languageId)) return void vscode.window.showInformationMessage("Open a LaTeX file first.");
    const key = doc.uri.toString();
    const have = this.panels.get(key);
    if (have) return have.panel.reveal(vscode.ViewColumn.Beside);
    const p = new Panel(doc, this.store, this.extensionUri, this.storage, () => this.panels.delete(key));
    this.panels.set(key, p);
  }

  dispose() {
    this.panels.forEach((p) => p.panel.dispose());
    vscode.Disposable.from(...this.disposables).dispose();
  }
}

class Panel {
  readonly panel: vscode.WebviewPanel;
  /** The open document for this file now: closing and reopening a file gives a new document object. */
  private get doc(): vscode.TextDocument {
    const k = this.opened.uri.toString();
    const now = vscode.workspace.textDocuments.find((d) => d.uri.toString() === k && !d.isClosed);
    if (now) this.opened = now;
    return this.opened;
  }
  private timer: NodeJS.Timeout | undefined;
  private refresh = false;
  private ready = false;
  /** PNGs the page already has. */
  private sentPictures = new Set<string>();

  constructor(private opened: vscode.TextDocument, private store: ReviewStore, private extensionUri: vscode.Uri, private storage: vscode.Uri, onClose: () => void) {
    const dir = vscode.Uri.file(path.dirname(opened.uri.fsPath));
    const roots = [vscode.Uri.joinPath(extensionUri, "dist"), vscode.Uri.joinPath(storage, "pictures"), dir, ...(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri)];
    this.panel = vscode.window.createWebviewPanel("latexReview.visual", `Visual: ${path.basename(opened.fileName)}`, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false }, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: roots,
    });
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, "images", "icon.png");
    this.panel.webview.html = this.html();
    this.panel.webview.onDidReceiveMessage((m: FromPage) =>
      this.receive(m).catch((e) => void vscode.window.showErrorMessage(`Visual editor: ${(e as Error)?.message ?? e}`)),
    );
    this.panel.onDidDispose(() => { clearTimeout(this.timer); onClose(); });
    void store.get(opened).then(() => this.schedule(0));
  }

  schedule(delay: number, refresh = false) {
    this.refresh ||= refresh;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.send(), delay);
  }

  cursor(offset: number) {
    if (!vscode.workspace.getConfiguration("latexReview.visual").get("followCursor", true)) return;
    void this.panel.webview.postMessage({ type: "cursor", offset });
  }

  private send() {
    if (!this.ready) return;
    const doc = this.build();
    const fresh: Record<string, string> = {};
    for (const b of doc.blocks) for (const im of b.fig?.images ?? []) {
      const id = im.uri?.startsWith("png:") ? im.uri.slice(4) : null;
      if (!id || this.sentPictures.has(id)) continue;
      try {
        fresh[id] = `data:image/png;base64,${fs.readFileSync(path.join(this.storage.fsPath, "pictures", `${id}.png`)).toString("base64")}`;
        this.sentPictures.add(id);
      } catch { /* removed from the cache */ }
    }
    if (Object.keys(fresh).length) void this.panel.webview.postMessage({ type: "pictures", items: fresh });
    void this.panel.webview.postMessage({ type: "doc", doc, refresh: this.refresh });
    this.refresh = false;
  }

  private build(): VDoc {
    const doc = this.doc;
    const text = doc.getText();
    const dir = path.dirname(doc.uri.fsPath);
    const refs = { labels: new Map<string, string>(), cites: new Map<string, string>() };
    const aux = path.join(dir, path.basename(doc.fileName).replace(/\.tex$/i, "") + ".aux");
    try {
      const r = readAux(fs.readFileSync(aux, "utf8"), refs);
      for (const sub of r.inputs) { try { readAux(fs.readFileSync(path.join(dir, sub), "utf8"), refs); } catch { /* missing chapter aux */ } }
    } catch { /* not built yet */ }
    const review = this.store.peek(doc);
    const gpaths = graphicsPaths(text);
    const stamp = (p: string) => { try { return String(fs.statSync(p).mtimeMs); } catch { return "0"; } };
    const images = (f: NonNullable<ReturnType<typeof figureAt>>): VImage[] =>
      f.graphics.map((g) => {
        for (const c of imageCandidates(g, gpaths)) {
          const p = path.resolve(dir, c);
          if (fs.existsSync(p) && fs.statSync(p).isFile()) {
            const tex = g.kind === "input" ? path.resolve(dir, g.path.endsWith(".tex") ? g.path : g.path + ".tex") : undefined;
            const entry = tex && fs.existsSync(tex) ? tex : undefined;
            // A PDF is shown as a PNG the system draws; until it is ready, or if it cannot be drawn, the page tries pdf.js.
            const size = /\.pdf$/i.test(p) ? pdfSize(p) : undefined;
            const labels = entry ? reactioLabels(entry) : undefined;
            const extra = { file: p, entry, widthPt: size?.w, heightPt: size?.h, labels };
            if (/\.pdf$/i.test(p)) {
              const png = pictureOf(p, path.join(this.storage.fsPath, "pictures"), () => this.schedule(0));
              // The PNG goes to the page as data (once per version): the page cannot always load files from the extension's storage.
              if (png === "pending") return { name: g.path, uri: null, pdf: false, pending: true, ...extra };
              if (png !== "failed") return { name: g.path, uri: `png:${path.basename(png, ".png")}`, pdf: false, ...extra };
            }
            const uri = this.panel.webview.asWebviewUri(vscode.Uri.file(p)).with({ query: `v=${stamp(p)}` }).toString();
            return { name: g.path, uri, pdf: /\.pdf$/i.test(p), ...extra };
          }
        }
        return { name: g.path, uri: null, pdf: false };
      });
    let bbl;
    try {
      bbl = parseBbl(fs.readFileSync(aux.replace(/\.aux$/, ".bbl"), "utf8"), refs.cites);
    } catch { /* no bibliography built yet */ }
    return buildDoc({
      bbl,
      text,
      uri: doc.uri.toString(),
      version: doc.version,
      name: path.basename(doc.fileName),
      look: { cites: refs.cites, labels: refs.labels, symbols: TEXT_SYMBOLS },
      tracking: !!review?.tracking,
      marks: (review?.changes ?? []).map((c) => ({ curStart: c.curStart, curEnd: c.curEnd, deleted: c.deleted })),
      images,
    });
  }

  /** Diagnostics: what the page sent and what came of it, in .latex-review/visual-log.txt beside the document. */
  private log(line: string) {
    try {
      const dir = path.join(path.dirname(this.opened.uri.fsPath), ".latex-review");
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, "visual-log.txt"), `${new Date().toISOString()} ${line}\n`);
    } catch { /* read-only folder */ }
  }

  private async receive(m: FromPage) {
    const doc = this.doc;
    // Page errors only; a normal session writes nothing.
    if ((m as { type: string }).type === "log") return this.log(`page: ${(m as unknown as { text: string }).text}`);
    switch (m.type) {
      case "ready":
        this.ready = true;
        this.sentPictures.clear();
        this.schedule(0, true);
        return;
      case "edit": {
        const text = doc.getText();
        if (text.slice(m.start, m.end) !== m.old) {
          this.log(`edit out of date at ${m.start}..${m.end}: page had ${JSON.stringify(m.old).slice(0, 100)}, file has ${JSON.stringify(text.slice(m.start, m.end)).slice(0, 100)}`);
          // The page drew an older text: redraw it from the source.
          console.warn("latex-review visual: edit out of date", m.start, m.end);
          return this.schedule(0, true);
        }
        if (m.old === m.text) return;
        const edit = new vscode.WorkspaceEdit();
        edit.replace(doc.uri, new vscode.Range(doc.positionAt(m.start), doc.positionAt(m.end)), m.text);
        const ok = await applyOwnEdit(doc.uri, edit);
        if (!ok) {
          this.log(`edit not applied at ${m.start}..${m.end} (doc v${doc.version})`);
          void vscode.window.showWarningMessage("Visual editor: the edit could not be written to the file.");
          this.schedule(0, true);
        }
        return;
      }
      case "join": {
        // Two paragraphs become one: the blank lines between them become a space.
        const gap = doc.getText().slice(m.start, m.end);
        if (m.end <= m.start || gap.trim()) return this.schedule(0, true);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(doc.uri, new vscode.Range(doc.positionAt(m.start), doc.positionAt(m.end)), " ");
        await applyOwnEdit(doc.uri, edit);
        return;
      }
      case "field": {
        const text = doc.getText();
        const f = figureAt(text, m.fig);
        if (!f || f.start !== m.fig) return this.schedule(0, true);
        const value = m.which === "label" ? m.value.replace(/[{}\\%\s]/g, "") : m.value;
        const old = f[m.which];
        if ((old && old.text === value) || (!old && !value)) return;
        const e = fieldEdit(text, f, m.which, value);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(doc.uri, new vscode.Range(doc.positionAt(e.start), doc.positionAt(e.end)), e.text);
        await applyOwnEdit(doc.uri, edit);
        return;
      }
      case "reveal": {
        if (!vscode.workspace.getConfiguration("latexReview.visual").get("followCursor", true)) return;
        const ed = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === doc.uri.toString());
        if (!ed) return;
        const p = doc.positionAt(m.offset);
        ed.revealRange(new vscode.Range(p, p), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        return;
      }
      case "decide":
        return vscode.commands.executeCommand(m.accept ? "latexReview.acceptChange" : "latexReview.rejectChange", { uri: doc.uri.toString(), curStart: m.curStart, curEnd: m.curEnd });
      case "jump": {
        const a = doc.positionAt(m.offset);
        const b = doc.positionAt(m.offset + Math.max(0, m.length));
        const shown = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === doc.uri.toString());
        const ed = await vscode.window.showTextDocument(doc, { viewColumn: shown?.viewColumn ?? vscode.ViewColumn.One, preserveFocus: false, selection: new vscode.Range(a, b) });
        ed.revealRange(new vscode.Range(a, b), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        return;
      }
      case "editFigure": {
        // Reactio Draw opens the drawing a figure was made from; otherwise open the picture itself.
        const target = vscode.Uri.file(m.entry ?? m.file);
        const cmds = await vscode.commands.getCommands(true);
        if (cmds.includes("reactioLatex.editFigureSource")) return vscode.commands.executeCommand("reactioLatex.editFigureSource", target);
        return vscode.commands.executeCommand("vscode.open", vscode.Uri.file(m.file), vscode.ViewColumn.Beside);
      }
      case "source": {
        const ed = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preserveFocus: false });
        return ed;
      }
    }
  }

  private html(): string {
    const w = this.panel.webview;
    const dist = (p: string) => w.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", p)).toString();
    const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const csp = w.cspSource;
    return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} data: blob:; font-src ${csp} data:; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}' ${csp}; worker-src ${csp} blob:; connect-src ${csp};">
<link rel="stylesheet" href="${dist("katex/katex.min.css")}">
<link rel="stylesheet" href="${dist("visual.css")}">
</head><body>
<div id="bar"></div>
<div id="page"><p class="loading">Loading…</p></div>
<script nonce="${nonce}" src="${dist("katex/katex.min.js")}"></script>
<script nonce="${nonce}" src="${dist("katex/mhchem.min.js")}"></script>
<script nonce="${nonce}">window.PDFJS_URL = ${JSON.stringify(dist("pdfjs/pdf.min.mjs"))}; window.PDFJS_WORKER = ${JSON.stringify(dist("pdfjs/pdf.worker.min.mjs"))};</script>
<script nonce="${nonce}" src="${dist("visual.js")}"></script>
</body></html>`;
  }
}

// ---- PDF pictures as PNG ---------------------------------------------------

const pictures = new Map<string, string | "pending" | "failed">();

/**
 * A PNG of a PDF's first page, drawn by the system (Quick Look or sips on
 * macOS, pdftoppm elsewhere) and cached by the file's version. Returns
 * "pending" while it is being drawn (onReady is called when done) and
 * "failed" when it cannot be.
 */
function pictureOf(pdf: string, cacheDir: string, onReady: () => void): string {
  let st: fs.Stats;
  try { st = fs.statSync(pdf); } catch { return "failed"; }
  const id = crypto.createHash("sha1").update(`${pdf}|${st.mtimeMs}|${st.size}`).digest("hex").slice(0, 16);
  const out = path.join(cacheDir, `${id}.png`);
  const have = pictures.get(id);
  if (have) return have;
  if (fs.existsSync(out) && fs.statSync(out).size > 0) { pictures.set(id, out); return out; }
  pictures.set(id, "pending");
  void drawPng(pdf, out).then((ok) => { pictures.set(id, ok ? out : "failed"); onReady(); });
  return "pending";
}

function run(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => execFile(cmd, args, { timeout: 20000 }, (err) => resolve(!err)));
}

async function drawPng(pdf: string, out: string): Promise<boolean> {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (process.platform === "darwin") {
    // Quick Look draws the vector page at the asked size; sips is the fallback (72 dpi).
    const tmp = fs.mkdtempSync(path.join(path.dirname(out), "ql-"));
    try {
      if (await run("qlmanage", ["-t", "-s", "1800", "-o", tmp, pdf])) {
        const made = fs.readdirSync(tmp).find((f) => f.endsWith(".png"));
        if (made) { fs.renameSync(path.join(tmp, made), out); return true; }
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    return (await run("sips", ["-s", "format", "png", pdf, "--out", out])) && fs.existsSync(out);
  }
  return (await run("pdftoppm", ["-png", "-r", "200", "-singlefile", pdf, out.replace(/\.png$/, "")])) && fs.existsSync(out);
}
