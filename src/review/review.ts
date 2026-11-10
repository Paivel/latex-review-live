import * as vscode from "vscode";
import * as path from "path";
import { Change, changeAt, computeChanges, kindOf } from "./diff";
import { ReviewFile, emptyReview, isEmptyReview, parseReview, serializeReview, shiftRange, reanchor, StoredThread } from "./model";
import { markUp } from "./markup";
import { applyOwnEdit } from "../own-edits";
import { ReviewPane, paneChange } from "./pane";

const isTex = (doc: vscode.TextDocument) => doc.languageId === "latex" || doc.languageId === "tex";

/** Sidecar beside the document: <dir>/.latex-review/<name>.json */
export function reviewUri(doc: vscode.Uri): vscode.Uri {
  const dir = path.posix.dirname(doc.path);
  return doc.with({ path: path.posix.join(dir, ".latex-review", path.posix.basename(doc.path) + ".json") });
}

export class DocReview {
  changes: Change[] = [];
  /** Sidecar differs from disk; written when the document is next saved (or now, if it is not dirty). */
  pending = false;
  constructor(public readonly uri: vscode.Uri, public data: ReviewFile) {}
  get tracking() {
    return this.data.baseline !== undefined;
  }
}

type Listener = (r: DocReview) => void;

/**
 * Holds the review state of each open LaTeX document and keeps it in step
 * with edits. Changes are always the word diff between the stored baseline
 * and the current text, so undo, redo and outside edits stay consistent.
 */
export class ReviewStore implements vscode.Disposable {
  private docs = new Map<string, DocReview>();
  private loading = new Map<string, Promise<DocReview>>();
  private timers = new Map<string, NodeJS.Timeout>();
  private listeners: Listener[] = [];
  private subs: vscode.Disposable[] = [];

  constructor() {
    this.subs.push(
      vscode.workspace.onDidChangeTextDocument((e) => this.onEdit(e)),
      vscode.workspace.onDidSaveTextDocument((d) => {
        const r = this.docs.get(d.uri.toString());
        if (r && r.pending) void this.write(r);
      }),
      // A closed document's unsaved review goes with its unsaved text; reopening reads the file again.
      vscode.workspace.onDidCloseTextDocument((d) => this.docs.delete(d.uri.toString())),
    );
  }

  onDidChange(l: Listener): vscode.Disposable {
    this.listeners.push(l);
    return { dispose: () => (this.listeners = this.listeners.filter((x) => x !== l)) };
  }

  private fire(r: DocReview) {
    for (const l of this.listeners) l(r);
  }

  peek(doc: vscode.TextDocument): DocReview | undefined {
    return this.docs.get(doc.uri.toString());
  }

  async get(doc: vscode.TextDocument): Promise<DocReview> {
    const key = doc.uri.toString();
    const have = this.docs.get(key);
    if (have) return have;
    let p = this.loading.get(key);
    if (!p) {
      p = this.load(doc);
      this.loading.set(key, p);
    }
    try {
      return await p;
    } finally {
      this.loading.delete(key);
    }
  }

  private async load(doc: vscode.TextDocument): Promise<DocReview> {
    let data = emptyReview();
    try {
      const bytes = await vscode.workspace.fs.readFile(reviewUri(doc.uri));
      data = parseReview(Buffer.from(bytes).toString("utf8"));
    } catch {
      // No review yet.
    }
    const text = doc.getText();
    for (const t of data.threads) [t.start, t.end] = reanchor(text, t.start, t.end, t.quote);
    const r = new DocReview(doc.uri, data);
    this.docs.set(doc.uri.toString(), r);
    this.recompute(r, doc);
    return r;
  }

  private onEdit(e: vscode.TextDocumentChangeEvent) {
    if (e.contentChanges.length === 0) return;
    const r = this.docs.get(e.document.uri.toString());
    if (!r) return;
    // contentChanges are against the text before the event and do not overlap;
    // apply from the last to the first so earlier offsets stay valid.
    const edits = [...e.contentChanges].sort((a, b) => b.rangeOffset - a.rangeOffset);
    let moved = false;
    for (const t of r.data.threads) {
      for (const c of edits) {
        const [s, en] = shiftRange(t.start, t.end, c.rangeOffset, c.rangeOffset + c.rangeLength, c.text.length);
        if (s !== t.start || en !== t.end) moved = true;
        t.start = s;
        t.end = en;
      }
    }
    if (moved) r.pending = true;
    if (r.tracking) this.schedule(r, e.document);
    else if (moved) this.fire(r);
  }

  private schedule(r: DocReview, doc: vscode.TextDocument) {
    const key = r.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        this.recompute(r, doc);
      }, 120),
    );
  }

  /** Recompute changes now (commands call this so they never act on stale ranges). */
  recompute(r: DocReview, doc: vscode.TextDocument) {
    clearTimeout(this.timers.get(r.uri.toString()));
    r.changes = r.data.baseline === undefined ? [] : computeChanges(r.data.baseline, doc.getText());
    this.fire(r);
  }

  /** Persist; if the document has unsaved edits, wait for its save so both stay in step. */
  async persist(r: DocReview, doc?: vscode.TextDocument) {
    r.pending = true;
    if (!doc || !doc.isDirty) await this.write(r);
    this.fire(r);
  }

  private async write(r: DocReview) {
    const uri = reviewUri(r.uri);
    try {
      if (isEmptyReview(r.data)) {
        try {
          await vscode.workspace.fs.delete(uri);
        } catch {
          // Nothing to delete.
        }
      } else {
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
        await vscode.workspace.fs.writeFile(uri, Buffer.from(serializeReview(r.data), "utf8"));
      }
      r.pending = false;
    } catch (err) {
      void vscode.window.showErrorMessage(`LaTeX Review: could not save the review: ${String(err)}`);
    }
  }

  dispose() {
    for (const t of this.timers.values()) clearTimeout(t);
    for (const s of this.subs) s.dispose();
  }
}

// ---------------------------------------------------------------------------
// Track changes UI

const MAX_SHOWN = 400;
const show = (s: string) => {
  const v = s.replace(/\r?\n/g, "↵ ");
  return v.length > MAX_SHOWN ? v.slice(0, MAX_SHOWN) + "…" : v;
};
const snippet = (s: string, n = 40) => {
  const v = s.replace(/\s+/g, " ").trim();
  return v.length > n ? v.slice(0, n - 1) + "…" : v;
};

function describe(c: Change): string {
  switch (kindOf(c)) {
    case "insert":
      return `+ ${snippet(c.inserted)}`;
    case "delete":
      return `− ${snippet(c.deleted)}`;
    default:
      return `${snippet(c.deleted, 20)} → ${snippet(c.inserted, 20)}`;
  }
}

/** Identifies a change across commands: its current range. */
interface ChangeRef {
  uri: string;
  curStart: number;
  curEnd: number;
}

export class TrackChanges implements vscode.Disposable {
  private inserted = vscode.window.createTextEditorDecorationType({
    color: new vscode.ThemeColor("latexReview.insertedForeground"),
    backgroundColor: new vscode.ThemeColor("latexReview.insertedBackground"),
    textDecoration: "underline",
    overviewRulerColor: new vscode.ThemeColor("latexReview.insertedForeground"),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  private deleted = vscode.window.createTextEditorDecorationType({
    overviewRulerColor: new vscode.ThemeColor("latexReview.deletedForeground"),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  private subs: vscode.Disposable[] = [];
  private codeLensChanged = new vscode.EventEmitter<void>();
  private treeChanged = new vscode.EventEmitter<void>();
  private status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
  private gutter: Record<"insert" | "delete" | "replace", vscode.TextEditorDecorationType>;
  private pane = new ReviewPane((m) => void this.fromPane(m));

  constructor(private store: ReviewStore, extensionUri: vscode.Uri) {
    const icon = (name: string) =>
      vscode.window.createTextEditorDecorationType({ gutterIconPath: vscode.Uri.joinPath(extensionUri, "images", `gutter-${name}.svg`), gutterIconSize: "contain" });
    this.gutter = { insert: icon("insert"), delete: icon("delete"), replace: icon("replace") };
    const sel: vscode.DocumentSelector = [{ language: "latex" }, { language: "tex" }];
    this.subs.push(
      this.inserted,
      this.deleted,
      ...Object.values(this.gutter),
      this.status,
      store.onDidChange((r) => {
        for (const ed of vscode.window.visibleTextEditors) if (ed.document.uri.toString() === r.uri.toString()) this.paint(ed, r);
        this.codeLensChanged.fire();
        this.treeChanged.fire();
        this.updateContext();
      }),
      vscode.window.onDidChangeVisibleTextEditors((eds) => eds.forEach((ed) => void this.attach(ed))),
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.updateContext();
        this.treeChanged.fire();
      }),
      vscode.languages.registerCodeLensProvider(sel, {
        onDidChangeCodeLenses: this.codeLensChanged.event,
        provideCodeLenses: (doc) => this.lenses(doc),
      }),
      vscode.languages.registerHoverProvider(sel, { provideHover: (doc, pos) => this.hover(doc, pos) }),
      vscode.languages.registerCodeActionsProvider(sel, { provideCodeActions: (doc, range) => this.actions(doc, range) }),
      vscode.window.registerWebviewViewProvider("latexReview.changes", this.pane, { webviewOptions: { retainContextWhenHidden: true } }),
      this.treeChanged.event(() => this.updatePane()),
      vscode.window.onDidChangeTextEditorSelection((e) => e.textEditor === vscode.window.activeTextEditor && this.updatePane()),
      vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("latexReview.codeLens") && this.codeLensChanged.fire()),
      vscode.commands.registerCommand("latexReview.startTracking", () => this.start()),
      vscode.commands.registerCommand("latexReview.stopTracking", () => this.stop()),
      vscode.commands.registerCommand("latexReview.acceptChange", (ref?: ChangeRef | { change: ChangeRef }) => this.decide(true, ref)),
      vscode.commands.registerCommand("latexReview.rejectChange", (ref?: ChangeRef | { change: ChangeRef }) => this.decide(false, ref)),
      vscode.commands.registerCommand("latexReview.acceptAll", () => this.decideAll(true)),
      vscode.commands.registerCommand("latexReview.rejectAll", () => this.decideAll(false)),
      vscode.commands.registerCommand("latexReview.nextChange", () => this.go(1)),
      vscode.commands.registerCommand("latexReview.previousChange", () => this.go(-1)),
      vscode.commands.registerCommand("latexReview.revealChange", (ref: ChangeRef) => this.reveal(ref)),
      vscode.commands.registerCommand("latexReview.exportMarkedUp", () => this.exportMarkedUp()),
    );
    this.status.command = "latexReview.startTracking";
    for (const ed of vscode.window.visibleTextEditors) void this.attach(ed);
    this.updateContext();
  }

  private async attach(ed: vscode.TextEditor) {
    if (!isTex(ed.document)) return;
    const r = await this.store.get(ed.document);
    this.paint(ed, r);
    this.updateContext();
  }

  private paint(ed: vscode.TextEditor, r: DocReview) {
    const doc = ed.document;
    const ins: vscode.DecorationOptions[] = [];
    const del: vscode.DecorationOptions[] = [];
    for (const c of r.changes) {
      if (c.inserted) ins.push({ range: new vscode.Range(doc.positionAt(c.curStart), doc.positionAt(c.curEnd)) });
      if (c.deleted) {
        const at = doc.positionAt(c.curStart);
        del.push({
          range: new vscode.Range(at, at),
          renderOptions: {
            before: {
              contentText: show(c.deleted),
              color: new vscode.ThemeColor("latexReview.deletedForeground"),
              textDecoration: "line-through",
            },
          },
        });
      }
    }
    ed.setDecorations(this.inserted, ins);
    ed.setDecorations(this.deleted, del);
    // One mark per line on the left, by the strongest kind of change on it.
    const lines = new Map<number, "insert" | "delete" | "replace">();
    for (const c of r.changes) {
      const k = kindOf(c);
      const from = doc.positionAt(c.curStart).line;
      const to = c.inserted ? doc.positionAt(c.curEnd).line : from;
      for (let l = from; l <= to; l++) {
        const was = lines.get(l);
        lines.set(l, !was || was === k ? k : "replace");
      }
    }
    for (const k of ["insert", "delete", "replace"] as const) {
      ed.setDecorations(this.gutter[k], [...lines].filter(([, v]) => v === k).map(([l]) => new vscode.Range(l, 0, l, 0)));
    }
  }

  private lastTex: vscode.TextEditor | undefined;
  /** The LaTeX editor in front, or the last one while focus is in the review pane. */
  private activeTex(): vscode.TextEditor | undefined {
    const ed = vscode.window.activeTextEditor;
    if (ed && isTex(ed.document)) return (this.lastTex = ed);
    if (this.lastTex && vscode.window.visibleTextEditors.includes(this.lastTex)) return this.lastTex;
    return undefined;
  }

  private updateContext() {
    const ed = this.activeTex();
    const r = ed && this.store.peek(ed.document);
    const tracking = !!r?.tracking;
    void vscode.commands.executeCommand("setContext", "latexReview.tracking", tracking);
    if (!ed) {
      this.status.hide();
      return;
    }
    if (tracking) {
      const n = r!.changes.length;
      this.status.text = `$(record) Tracking · ${n}`;
      this.status.tooltip = `Changes are tracked (${n} pending). Click to stop.`;
      this.status.command = "latexReview.stopTracking";
    } else {
      this.status.text = "$(circle-outline) Track changes";
      this.status.tooltip = "Start tracking changes in this document";
      this.status.command = "latexReview.startTracking";
    }
    this.status.show();
  }

  private async start() {
    const ed = this.activeTex();
    if (!ed) {
      void vscode.window.showInformationMessage("Open a LaTeX document to track its changes.");
      return;
    }
    const r = await this.store.get(ed.document);
    if (r.tracking) return;
    r.data.baseline = ed.document.getText();
    r.data.trackingSince = new Date().toISOString();
    this.store.recompute(r, ed.document);
    await this.store.persist(r, ed.document);
    void vscode.commands.executeCommand("latexReview.changes.focus").then(undefined, () => undefined);
    void vscode.window.showTextDocument(ed.document, ed.viewColumn);
  }

  private async stop() {
    const ed = this.activeTex();
    if (!ed) return;
    const r = await this.store.get(ed.document);
    if (!r.tracking) return;
    this.store.recompute(r, ed.document);
    if (r.changes.length > 0) {
      const pick = await vscode.window.showWarningMessage(
        `${r.changes.length} change(s) are still pending. Stop tracking?`,
        { modal: true },
        "Accept All and Stop",
        "Reject All and Stop",
      );
      if (!pick) return;
      if (pick.startsWith("Reject")) await this.applyReject(ed.document, r, r.changes);
    }
    delete r.data.baseline;
    delete r.data.trackingSince;
    this.store.recompute(r, ed.document);
    await this.store.persist(r, ed.document);
  }

  /** Changes a command acts on: the one passed, else those in or touching the selections. */
  private target(r: DocReview, ed: vscode.TextEditor | undefined, ref?: ChangeRef): Change[] {
    if (ref) {
      const c = r.changes.find((x) => x.curStart === ref.curStart && x.curEnd === ref.curEnd);
      return c ? [c] : [];
    }
    if (!ed) return [];
    const doc = ed.document;
    const out = new Set<Change>();
    for (const s of ed.selections) {
      const a = doc.offsetAt(s.start);
      const b = doc.offsetAt(s.end);
      if (a === b) {
        const c = changeAt(r.changes, a);
        if (c) out.add(c);
      } else {
        for (const c of r.changes) if (c.curEnd >= a && c.curStart <= b) out.add(c);
      }
    }
    return [...out];
  }

  private async docFor(ref?: ChangeRef): Promise<[vscode.TextDocument, vscode.TextEditor | undefined] | undefined> {
    if (ref) {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(ref.uri));
      const ed = vscode.window.visibleTextEditors.find((e) => e.document === doc);
      return [doc, ed];
    }
    const ed = this.activeTex();
    return ed ? [ed.document, ed] : undefined;
  }

  private async decide(accept: boolean, arg?: ChangeRef | { change: ChangeRef }) {
    const ref = arg && "change" in arg ? arg.change : arg;
    const found = await this.docFor(ref);
    if (!found) return;
    const [doc, ed] = found;
    const r = await this.store.get(doc);
    if (!r.tracking) return;
    this.store.recompute(r, doc);
    const picked = this.target(r, ref ? undefined : ed, ref);
    if (picked.length === 0) {
      void vscode.window.setStatusBarMessage("No tracked change here", 2500);
      return;
    }
    if (accept) await this.applyAccept(doc, r, picked);
    else await this.applyReject(doc, r, picked);
  }

  private async decideAll(accept: boolean) {
    const ed = this.activeTex();
    if (!ed) return;
    const r = await this.store.get(ed.document);
    this.store.recompute(r, ed.document);
    if (r.changes.length === 0) return;
    if (accept) await this.applyAccept(ed.document, r, r.changes);
    else await this.applyReject(ed.document, r, r.changes);
  }

  private async applyAccept(doc: vscode.TextDocument, r: DocReview, picked: Change[]) {
    let base = r.data.baseline!;
    for (const c of [...picked].sort((a, b) => b.baseStart - a.baseStart)) base = base.slice(0, c.baseStart) + c.inserted + base.slice(c.baseEnd);
    r.data.baseline = base;
    this.store.recompute(r, doc);
    await this.store.persist(r, doc);
  }

  private async applyReject(doc: vscode.TextDocument, r: DocReview, picked: Change[]) {
    const edit = new vscode.WorkspaceEdit();
    for (const c of picked) {
      edit.replace(doc.uri, new vscode.Range(doc.positionAt(c.curStart), doc.positionAt(c.curEnd)), c.deleted);
    }
    await applyOwnEdit(doc.uri, edit);
    this.store.recompute(r, doc);
  }

  private async go(dir: 1 | -1) {
    const ed = this.activeTex();
    if (!ed) return;
    const r = await this.store.get(ed.document);
    this.store.recompute(r, ed.document);
    if (r.changes.length === 0) return;
    const here = ed.document.offsetAt(ed.selection.active);
    let c: Change | undefined;
    if (dir === 1) c = r.changes.find((x) => x.curStart > here) ?? r.changes[0];
    else c = [...r.changes].reverse().find((x) => x.curEnd < here) ?? r.changes[r.changes.length - 1];
    this.select(ed, c);
  }

  private select(ed: vscode.TextEditor, c: Change) {
    const doc = ed.document;
    const range = new vscode.Range(doc.positionAt(c.curStart), doc.positionAt(c.curEnd));
    ed.selection = new vscode.Selection(range.start, range.end);
    ed.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  private async reveal(ref: ChangeRef) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(ref.uri));
    const ed = await vscode.window.showTextDocument(doc, { preserveFocus: false });
    const r = await this.store.get(doc);
    const c = r.changes.find((x) => x.curStart === ref.curStart && x.curEnd === ref.curEnd);
    if (c) this.select(ed, c);
  }

  private ref(doc: vscode.TextDocument, c: Change): ChangeRef {
    return { uri: doc.uri.toString(), curStart: c.curStart, curEnd: c.curEnd };
  }

  private lenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    if (!vscode.workspace.getConfiguration("latexReview").get<boolean>("codeLens", true)) return [];
    const r = this.store.peek(doc);
    if (!r?.tracking) return [];
    const byLine = new Map<number, Change[]>();
    for (const c of r.changes) {
      const line = doc.positionAt(c.curStart).line;
      byLine.set(line, [...(byLine.get(line) ?? []), c]);
    }
    const out: vscode.CodeLens[] = [];
    for (const [line, cs] of byLine) {
      const range = new vscode.Range(line, 0, line, 0);
      if (cs.length === 1) {
        const ref = this.ref(doc, cs[0]);
        out.push(
          new vscode.CodeLens(range, { title: "🟢 Accept", command: "latexReview.acceptChange", arguments: [ref] }),
          new vscode.CodeLens(range, { title: "🔴 Reject", command: "latexReview.rejectChange", arguments: [ref] }),
        );
      } else {
        for (const c of cs.slice(0, 4)) {
          const ref = this.ref(doc, c);
          out.push(
            new vscode.CodeLens(range, { title: `🟢 ${describe(c)}`, tooltip: "Accept this change", command: "latexReview.acceptChange", arguments: [ref] }),
            new vscode.CodeLens(range, { title: "🔴", tooltip: "Reject this change", command: "latexReview.rejectChange", arguments: [ref] }),
          );
        }
        if (cs.length > 4) out.push(new vscode.CodeLens(range, { title: `+${cs.length - 4} more`, command: "latexReview.nextChange" }));
      }
    }
    return out;
  }

  private hover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | undefined {
    const r = this.store.peek(doc);
    if (!r?.tracking) return;
    const c = changeAt(r.changes, doc.offsetAt(pos));
    if (!c) return;
    const arg = encodeURIComponent(JSON.stringify([this.ref(doc, c)]));
    const md = new vscode.MarkdownString();
    md.isTrusted = { enabledCommands: ["latexReview.acceptChange", "latexReview.rejectChange"] };
    const k = kindOf(c);
    md.appendMarkdown(k === "insert" ? "**Inserted**" : k === "delete" ? "**Deleted**" : "**Replaced**");
    if (c.deleted) md.appendMarkdown("\n\nWas:").appendCodeblock(show(c.deleted), "latex");
    if (c.inserted) md.appendMarkdown(k === "replace" ? "Now:" : "").appendCodeblock(show(c.inserted), "latex");
    md.appendMarkdown(`[$(check) Accept](command:latexReview.acceptChange?${arg}) · [$(close) Reject](command:latexReview.rejectChange?${arg})`);
    md.supportThemeIcons = true;
    return new vscode.Hover(md, new vscode.Range(doc.positionAt(c.curStart), doc.positionAt(c.curEnd)));
  }

  private actions(doc: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
    const r = this.store.peek(doc);
    if (!r?.tracking) return [];
    const a = doc.offsetAt(range.start);
    const b = doc.offsetAt(range.end);
    const hit = a === b ? [changeAt(r.changes, a)].filter((x): x is Change => !!x) : r.changes.filter((c) => c.curEnd >= a && c.curStart <= b);
    if (hit.length === 0) return [];
    const what = hit.length === 1 ? "Change" : `${hit.length} Changes`;
    const acc = new vscode.CodeAction(`Accept ${what}`, vscode.CodeActionKind.QuickFix);
    acc.command = { title: acc.title, command: "latexReview.acceptChange" };
    const rej = new vscode.CodeAction(`Reject ${what}`, vscode.CodeActionKind.QuickFix);
    rej.command = { title: rej.title, command: "latexReview.rejectChange" };
    return [acc, rej];
  }

  private updatePane() {
    const ed = this.activeTex();
    const r = ed && this.store.peek(ed.document);
    if (!ed || !r) {
      this.pane.show({ tracking: false, threads: [], hasSelection: false, changes: [], current: -1 });
      return;
    }
    const doc = ed.document;
    const threads = r.data.threads.map((t) => ({
      uri: doc.uri.toString(),
      id: t.id,
      line: doc.positionAt(t.start).line + 1,
      quote: doc.getText().slice(t.start, t.end).replace(/\s+/g, " ").slice(0, 80),
      resolved: t.resolved,
      comments: t.comments.map((c) => ({ author: c.author, body: c.body, when: c.created ? new Date(c.created).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "" })),
    }));
    const hasSelection = !ed.selection.isEmpty;
    if (!r.tracking) {
      this.pane.show({ tracking: false, threads, hasSelection, changes: [], current: -1 });
      return;
    }
    const here = doc.offsetAt(ed.selection.active);
    const changes = r.changes.map((c) => paneChange(doc, c));
    this.pane.show({ tracking: true, threads, hasSelection, changes, current: r.changes.findIndex((c) => here >= c.curStart && here <= c.curEnd) });
  }

  private async fromPane(m: { type: string; change?: ChangeRef; thread?: string; text?: string }) {
    const ed = this.activeTex();
    if (m.type === "comment" && ed) {
      let range: vscode.Range = ed.selection;
      if (range.isEmpty) range = ed.document.getWordRangeAtPosition(range.start) ?? ed.document.lineAt(range.start.line).range;
      const doc = ed.document;
      return vscode.commands.executeCommand("latexReview.paneComment", { uri: doc.uri.toString(), start: doc.offsetAt(range.start), end: doc.offsetAt(range.end), text: m.text ?? "" });
    }
    if (m.thread && ed) {
      const action = { showThread: "reveal", deleteThread: "delete" }[m.type] ?? m.type;
      return vscode.commands.executeCommand("latexReview.paneThread", { uri: ed.document.uri.toString(), id: m.thread, action, text: m.text });
    }
    const ref = m.change ? { uri: m.change.uri, curStart: m.change.curStart, curEnd: m.change.curEnd } : undefined;
    switch (m.type) {
      case "accept":
        return this.decide(true, ref);
      case "reject":
        return this.decide(false, ref);
      case "acceptAll":
        return this.decideAll(true);
      case "rejectAll":
        return this.decideAll(false);
      case "start":
        return this.start();
      case "stop":
        return this.stop();
      case "reveal":
        if (ref) return this.reveal(ref);
    }
  }

  private async exportMarkedUp() {
    const ed = this.activeTex();
    if (!ed) return;
    const doc = ed.document;
    const r = await this.store.get(doc);
    this.store.recompute(r, doc);
    const out = markUp(doc.getText(), r.changes, r.data.threads.filter((t) => !t.resolved));
    const target = doc.uri.with({ path: doc.uri.path.replace(/(\.tex)?$/i, "-review.tex") });
    await vscode.workspace.fs.writeFile(target, Buffer.from(out.text, "utf8"));
    const note = out.plain > 0 ? ` ${out.plain} change(s) in math or across braces are left unmarked.` : "";
    const open = await vscode.window.showInformationMessage(`Wrote ${path.posix.basename(target.path)} with the changes package markup.${note}`, "Open");
    if (open) await vscode.window.showTextDocument(target);
  }

  dispose() {
    this.subs.forEach((s) => s.dispose());
    this.codeLensChanged.dispose();
    this.treeChanged.dispose();
  }
}

export type { StoredThread };
