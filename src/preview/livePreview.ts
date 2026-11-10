import * as vscode from "vscode";
import * as path from "path";
import { Piece, Refs, Style, noRefs, parseLatex } from "./parse";
import { readAux } from "./aux";

const isTex = (doc: vscode.TextDocument) => doc.languageId === "latex" || doc.languageId === "tex";

type Look = vscode.ThemableDecorationRenderOptions;

const LOOKS: Record<Style, Look> = {
  bold: { fontWeight: "bold" },
  italic: { fontStyle: "italic" },
  underline: { textDecoration: "underline" },
  code: { backgroundColor: new vscode.ThemeColor("textCodeBlock.background") },
  smallcaps: { textDecoration: "none; font-variant: small-caps" },
  heading1: { fontWeight: "bold", color: new vscode.ThemeColor("latexReview.previewHeading"), textDecoration: "none; font-size: 1.2em" },
  heading2: { fontWeight: "bold", color: new vscode.ThemeColor("latexReview.previewHeading"), textDecoration: "none; font-size: 1.1em" },
  heading3: { fontWeight: "bold", color: new vscode.ThemeColor("latexReview.previewHeading") },
  math: { color: new vscode.ThemeColor("latexReview.previewMath") },
  ref: { color: new vscode.ThemeColor("latexReview.previewReference") },
  muted: { color: new vscode.ThemeColor("latexReview.previewMuted") },
  note: { color: new vscode.ThemeColor("latexReview.previewMuted"), fontStyle: "italic" },
  link: { color: new vscode.ThemeColor("latexReview.previewReference"), textDecoration: "underline" },
};

function attachmentLook(style: Style | undefined): vscode.ThemableDecorationAttachmentRenderOptions {
  if (!style) return {};
  const l = LOOKS[style];
  const out: vscode.ThemableDecorationAttachmentRenderOptions = {};
  if (l.color) out.color = l.color;
  if (l.fontStyle) out.fontStyle = l.fontStyle;
  if (l.fontWeight) out.fontWeight = l.fontWeight;
  if (l.textDecoration) out.textDecoration = l.textDecoration;
  if (l.backgroundColor) out.backgroundColor = l.backgroundColor;
  return out;
}

/**
 * Obsidian-style live preview in the normal text editor: LaTeX code is hidden
 * with decorations and the text it formats is styled, so the document stays
 * an ordinary .tex file that LaTeX Workshop builds and syncs as usual.
 */
export class LivePreview implements vscode.Disposable {
  private on = new Set<string>();
  private off = new Set<string>();
  private cache = new Map<string, { version: number; pieces: Piece[] }>();
  private refs = new Map<string, Refs>();
  private hideType = vscode.window.createTextEditorDecorationType({
    textDecoration: "none; display: none;",
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  private styleTypes = new Map<Style, vscode.TextEditorDecorationType>();
  private status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  private timers = new Map<string, NodeJS.Timeout>();
  private subs: vscode.Disposable[] = [];

  constructor(private state: vscode.Memento) {
    for (const [k, look] of Object.entries(LOOKS) as [Style, Look][]) {
      this.styleTypes.set(k, vscode.window.createTextEditorDecorationType({ ...look, rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed }));
    }
    for (const u of state.get<string[]>("latexReview.liveDocs", [])) this.on.add(u);
    for (const u of state.get<string[]>("latexReview.sourceDocs", [])) this.off.add(u);

    const aux = vscode.workspace.createFileSystemWatcher("**/*.aux");
    const auxChanged = () => {
      this.refs.clear();
      this.cache.clear();
      this.repaintAll();
    };
    this.subs.push(
      this.hideType,
      ...this.styleTypes.values(),
      this.status,
      aux,
      aux.onDidChange(auxChanged),
      aux.onDidCreate(auxChanged),
      vscode.commands.registerCommand("latexReview.toggleLivePreview", () => this.toggle()),
      vscode.commands.registerCommand("latexReview.showLivePreview", () => this.set(true)),
      vscode.commands.registerCommand("latexReview.showSource", () => this.set(false)),
      vscode.window.onDidChangeVisibleTextEditors(() => this.repaintAll()),
      vscode.window.onDidChangeActiveTextEditor(() => this.updateStatus()),
      vscode.window.onDidChangeTextEditorSelection((e) => this.isOn(e.textEditor.document) && this.paint(e.textEditor)),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (!this.isOn(e.document) || e.contentChanges.length === 0) return;
        const key = e.document.uri.toString();
        clearTimeout(this.timers.get(key));
        this.timers.set(
          key,
          setTimeout(() => {
            this.timers.delete(key);
            for (const ed of vscode.window.visibleTextEditors) if (ed.document === e.document) this.paint(ed);
          }, 60),
        );
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("latexReview.livePreview")) this.repaintAll();
      }),
      vscode.workspace.onDidCloseTextDocument((d) => this.cache.delete(d.uri.toString())),
    );
    this.repaintAll();
  }

  isOn(doc: vscode.TextDocument): boolean {
    if (!isTex(doc)) return false;
    const k = doc.uri.toString();
    if (this.on.has(k)) return true;
    if (this.off.has(k)) return false;
    return vscode.workspace.getConfiguration("latexReview").get<boolean>("livePreview.default", false);
  }

  private async toggle() {
    const ed = vscode.window.activeTextEditor;
    if (!ed || !isTex(ed.document)) return;
    await this.set(!this.isOn(ed.document));
  }

  private async set(live: boolean) {
    const ed = vscode.window.activeTextEditor;
    if (!ed || !isTex(ed.document)) return;
    const k = ed.document.uri.toString();
    if (live) {
      this.on.add(k);
      this.off.delete(k);
    } else {
      this.off.add(k);
      this.on.delete(k);
    }
    await this.state.update("latexReview.liveDocs", [...this.on].slice(-200));
    await this.state.update("latexReview.sourceDocs", [...this.off].slice(-200));
    this.repaintAll();
  }

  private repaintAll() {
    for (const ed of vscode.window.visibleTextEditors) if (isTex(ed.document)) this.paint(ed);
    this.updateStatus();
  }

  private updateStatus() {
    const ed = vscode.window.activeTextEditor;
    const tex = !!ed && isTex(ed.document);
    const live = tex && this.isOn(ed!.document);
    void vscode.commands.executeCommand("setContext", "latexReview.livePreview", live);
    if (!tex) {
      this.status.hide();
      return;
    }
    this.status.text = live ? "$(eye) Live Preview" : "$(code) Source";
    this.status.tooltip = live ? "LaTeX code is hidden. Click to show the source." : "Click for live preview: LaTeX code hidden, text still editable.";
    this.status.command = "latexReview.toggleLivePreview";
    this.status.show();
  }

  private pieces(doc: vscode.TextDocument): Piece[] {
    const k = doc.uri.toString();
    const c = this.cache.get(k);
    if (c && c.version === doc.version) return c.pieces;
    const pieces = parseLatex(doc.getText(), this.refsFor(doc));
    this.cache.set(k, { version: doc.version, pieces });
    return pieces;
  }

  /** Labels and citations of the document's build, read from its .aux. */
  private refsFor(doc: vscode.TextDocument): Refs {
    if (doc.uri.scheme !== "file") return noRefs();
    const root = rootFile(doc);
    const have = this.refs.get(root);
    if (have) return have;
    const refs = noRefs();
    this.refs.set(root, refs);
    void loadAux(root, refs).then((found) => {
      if (found) {
        this.cache.clear();
        this.repaintAll();
      }
    });
    return refs;
  }

  private paint(ed: vscode.TextEditor) {
    const doc = ed.document;
    if (!this.isOn(doc)) {
      ed.setDecorations(this.hideType, []);
      for (const t of this.styleTypes.values()) ed.setDecorations(t, []);
      return;
    }
    const pieces = this.pieces(doc);
    const mode = vscode.workspace.getConfiguration("latexReview").get<string>("livePreview.reveal", "element");
    const sel = ed.selections.map((s) => {
      if (mode === "line") return [doc.offsetAt(doc.lineAt(s.start.line).range.start), doc.offsetAt(doc.lineAt(s.end.line).range.end)];
      return [doc.offsetAt(s.start), doc.offsetAt(s.end)];
    });
    const revealed = (p: Piece) => mode !== "never" && sel.some(([a, b]) => p.owner[0] <= b && p.owner[1] >= a);

    const hidden: vscode.DecorationOptions[] = [];
    const styled = new Map<Style, vscode.Range[]>();
    for (const p of pieces) {
      const range = new vscode.Range(doc.positionAt(p.start), doc.positionAt(p.end));
      if (p.style) {
        let list = styled.get(p.style);
        if (!list) styled.set(p.style, (list = []));
        list.push(range);
      }
      if (p.hide && !revealed(p)) {
        const o: vscode.DecorationOptions = { range };
        if (p.text) o.renderOptions = { before: { contentText: p.text, ...attachmentLook(p.textStyle) } };
        hidden.push(o);
      }
    }
    ed.setDecorations(this.hideType, hidden);
    for (const [s, t] of this.styleTypes) ed.setDecorations(t, styled.get(s) ?? []);
  }

  dispose() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.subs.forEach((s) => s.dispose());
  }
}

/** The main file: `% !TeX root = …` if the document names one, else the document. */
function rootFile(doc: vscode.TextDocument): string {
  const head = doc.getText(new vscode.Range(0, 0, Math.min(doc.lineCount, 30), 0));
  const m = /^\s*%\s*!\s*TeX\s+root\s*=\s*(.+?)\s*$/im.exec(head);
  if (m) return path.resolve(path.dirname(doc.uri.fsPath), m[1]);
  return doc.uri.fsPath;
}

async function loadAux(root: string, refs: Refs): Promise<boolean> {
  const dir = path.dirname(root);
  const base = path.basename(root).replace(/\.tex$/i, "");
  const cfg = vscode.workspace.getConfiguration("latex-workshop", vscode.Uri.file(root));
  const outDir = (cfg.get<string>("latex.outDir", "%DIR%") || "%DIR%")
    .replace(/%DIR%/g, dir)
    .replace(/%DOCFILE%/g, base)
    .replace(/%WORKSPACE_FOLDER%/g, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? dir);
  const auxDir = cfg.get<string>("latex.auxDir", "")?.replace(/%DIR%/g, dir).replace(/%DOCFILE%/g, base) ?? "";
  const candidates = [auxDir, outDir, dir, path.join(dir, "build"), path.join(dir, "out")]
    .filter(Boolean)
    .map((d) => path.resolve(dir, d, base + ".aux"));
  for (const file of [...new Set(candidates)]) {
    const text = await read(file);
    if (text === undefined) continue;
    const seen = new Set<string>([file]);
    const queue = readAux(text, refs).inputs.map((i) => path.resolve(path.dirname(file), i));
    while (queue.length) {
      const f = queue.shift()!;
      if (seen.has(f)) continue;
      seen.add(f);
      const t = await read(f);
      if (t !== undefined) queue.push(...readAux(t, refs).inputs.map((i) => path.resolve(path.dirname(file), i)));
    }
    return true;
  }
  return false;
}

async function read(file: string): Promise<string | undefined> {
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(file))).toString("utf8");
  } catch {
    return undefined;
  }
}
