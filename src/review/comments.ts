import * as vscode from "vscode";
import { execFile } from "child_process";
import * as os from "os";
import { DocReview, ReviewStore } from "./review";
import { StoredComment, StoredThread, newId } from "./model";

const isTex = (doc: vscode.TextDocument) => doc.languageId === "latex" || doc.languageId === "tex";

class NoteComment implements vscode.Comment {
  mode = vscode.CommentMode.Preview;
  savedBody: string;
  contextValue: string;
  constructor(
    public stored: StoredComment,
    public parent: vscode.CommentThread,
    me: string,
  ) {
    this.savedBody = stored.body;
    this.contextValue = stored.author === me ? "mine" : "theirs";
  }
  get body(): string | vscode.MarkdownString {
    return this._body ?? new vscode.MarkdownString(this.stored.body);
  }
  set body(v: string | vscode.MarkdownString) {
    this._body = v;
  }
  private _body: string | vscode.MarkdownString | undefined;
  get author(): vscode.CommentAuthorInformation {
    return { name: this.stored.author || "Unknown" };
  }
  get label(): string | undefined {
    const d = this.stored.edited ?? this.stored.created;
    if (!d) return undefined;
    const when = new Date(d);
    return (this.stored.edited ? "edited " : "") + when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }
  get timestamp(): Date | undefined {
    return this.stored.created ? new Date(this.stored.created) : undefined;
  }
}

/**
 * Word-style comments on ranges of a LaTeX document, using VS Code's comment
 * threads. They are kept in the review file beside the document and follow
 * the text as it is edited.
 */
export class Comments implements vscode.Disposable {
  private controller = vscode.comments.createCommentController("latexReview", "LaTeX Review");
  /** Live threads per document, by stored thread id. */
  private live = new Map<string, Map<string, vscode.CommentThread>>();
  private byThread = new WeakMap<vscode.CommentThread, { doc: vscode.Uri; id: string }>();
  private subs: vscode.Disposable[] = [];
  private me = "";
  private highlight = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor("latexReview.commentBackground"),
    overviewRulerColor: new vscode.ThemeColor("latexReview.commentBackground"),
    overviewRulerLane: vscode.OverviewRulerLane.Center,
  });

  constructor(private store: ReviewStore) {
    this.controller.options = { prompt: "Add a comment", placeHolder: "Comment on this text" };
    this.controller.commentingRangeProvider = {
      provideCommentingRanges: (doc) => (isTex(doc) ? [new vscode.Range(0, 0, Math.max(doc.lineCount - 1, 0), 0)] : []),
    };
    this.subs.push(
      this.controller,
      this.highlight,
      store.onDidChange((r) => this.sync(r)),
      vscode.window.onDidChangeVisibleTextEditors((eds) => eds.forEach((ed) => isTex(ed.document) && void this.store.get(ed.document).then((r) => this.sync(r)))),
      vscode.commands.registerCommand("latexReview.addComment", () => this.add()),
      vscode.commands.registerCommand("latexReview.replyComment", (reply: vscode.CommentReply) => this.reply(reply)),
      vscode.commands.registerCommand("latexReview.resolveThread", (t: vscode.CommentThread) => this.setResolved(t, true)),
      vscode.commands.registerCommand("latexReview.reopenThread", (t: vscode.CommentThread) => this.setResolved(t, false)),
      vscode.commands.registerCommand("latexReview.deleteThread", (t: vscode.CommentThread) => this.deleteThread(t)),
      vscode.commands.registerCommand("latexReview.deleteComment", (c: NoteComment) => this.deleteComment(c)),
      vscode.commands.registerCommand("latexReview.editComment", (c: NoteComment) => this.setMode(c, vscode.CommentMode.Editing)),
      vscode.commands.registerCommand("latexReview.cancelEditComment", (c: NoteComment) => {
        c.body = new vscode.MarkdownString(c.savedBody);
        this.setMode(c, vscode.CommentMode.Preview);
      }),
      vscode.commands.registerCommand("latexReview.saveComment", (c: NoteComment) => this.saveEdit(c)),
    );
    void this.resolveAuthor().then(() => this.refreshOwnership());
    for (const ed of vscode.window.visibleTextEditors) if (isTex(ed.document)) void store.get(ed.document).then((r) => this.sync(r));
  }

  private async resolveAuthor() {
    const set = vscode.workspace.getConfiguration("latexReview").get<string>("author", "").trim();
    if (set) {
      this.me = set;
      return;
    }
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.scheme === "file" ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;
    this.me = await new Promise<string>((resolve) =>
      execFile("git", ["config", "user.name"], { cwd, timeout: 3000 }, (err, out) => resolve(err ? "" : String(out).trim())),
    );
    if (!this.me) {
      try {
        this.me = os.userInfo().username;
      } catch {
        this.me = "Me";
      }
    }
  }

  /** Mark which comments are the user's, once their name is known (only those can be edited). */
  private refreshOwnership() {
    const me = this.author();
    for (const map of this.live.values()) {
      for (const th of map.values()) {
        th.comments = th.comments.map((c) => {
          if (c instanceof NoteComment) c.contextValue = c.stored.author === me ? "mine" : "theirs";
          return c;
        });
      }
    }
  }

  private author(): string {
    return vscode.workspace.getConfiguration("latexReview").get<string>("author", "").trim() || this.me || "Me";
  }

  private async docOf(uri: vscode.Uri) {
    return vscode.workspace.openTextDocument(uri);
  }

  private rangeOf(doc: vscode.TextDocument, t: StoredThread): vscode.Range {
    return new vscode.Range(doc.positionAt(t.start), doc.positionAt(t.end));
  }

  /** Bring the UI threads in line with the stored ones. */
  private sync(r: DocReview) {
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === r.uri.toString());
    if (!doc) return;
    const key = r.uri.toString();
    let map = this.live.get(key);
    if (!map) this.live.set(key, (map = new Map()));
    const seen = new Set<string>();
    for (const t of r.data.threads) {
      seen.add(t.id);
      let th = map.get(t.id);
      const range = this.rangeOf(doc, t);
      if (!th) {
        th = this.controller.createCommentThread(r.uri, range, []);
        th.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
        this.byThread.set(th, { doc: r.uri, id: t.id });
        map.set(t.id, th);
        th.comments = t.comments.map((c) => new NoteComment(c, th!, this.author()));
      } else if (!th.range || !th.range.isEqual(range)) {
        th.range = range;
      }
      th.label = t.resolved ? "Resolved" : undefined;
      th.contextValue = t.resolved ? "resolved" : "open";
      th.state = t.resolved ? vscode.CommentThreadState.Resolved : vscode.CommentThreadState.Unresolved;
      th.canReply = !t.resolved;
    }
    for (const [id, th] of map) {
      if (!seen.has(id)) {
        th.dispose();
        map.delete(id);
      }
    }
    for (const ed of vscode.window.visibleTextEditors) {
      if (ed.document.uri.toString() !== key) continue;
      ed.setDecorations(
        this.highlight,
        r.data.threads.filter((t) => !t.resolved && t.end > t.start).map((t) => this.rangeOf(doc, t)),
      );
    }
  }

  private async add() {
    const ed = vscode.window.activeTextEditor;
    if (!ed || !isTex(ed.document)) return;
    let range: vscode.Range = ed.selection;
    if (range.isEmpty) {
      const w = ed.document.getWordRangeAtPosition(range.start);
      range = w ?? ed.document.lineAt(range.start.line).range;
    }
    const th = this.controller.createCommentThread(ed.document.uri, range, []);
    th.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    th.canReply = true;
    th.contextValue = "open";
  }

  private async reply(reply: vscode.CommentReply) {
    const th = reply.thread;
    const text = reply.text.trim();
    if (!text) return;
    const doc = await this.docOf(th.uri);
    const r = await this.store.get(doc);
    const now = new Date().toISOString();
    const comment: StoredComment = { id: newId(), author: this.author(), body: text, created: now };
    let link = this.byThread.get(th);
    let stored = link && r.data.threads.find((t) => t.id === link!.id);
    if (!stored) {
      const range = th.range ?? new vscode.Range(0, 0, 0, 0);
      const start = doc.offsetAt(range.start);
      const end = doc.offsetAt(range.end);
      stored = { id: newId(), start, end, quote: doc.getText().slice(start, end), resolved: false, comments: [] };
      r.data.threads.push(stored);
      r.data.threads.sort((a, b) => a.start - b.start);
      link = { doc: th.uri, id: stored.id };
      this.byThread.set(th, link);
      let map = this.live.get(th.uri.toString());
      if (!map) this.live.set(th.uri.toString(), (map = new Map()));
      map.set(stored.id, th);
    }
    stored.comments.push(comment);
    th.comments = [...th.comments, new NoteComment(comment, th, this.author())];
    th.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    await this.store.persist(r, doc);
  }

  private async withStored(th: vscode.CommentThread, f: (t: StoredThread, r: DocReview, doc: vscode.TextDocument) => void | Promise<void>) {
    const link = this.byThread.get(th);
    if (!link) {
      th.dispose();
      return;
    }
    const doc = await this.docOf(link.doc);
    const r = await this.store.get(doc);
    const t = r.data.threads.find((x) => x.id === link.id);
    if (!t) return;
    await f(t, r, doc);
    await this.store.persist(r, doc);
  }

  private setResolved(th: vscode.CommentThread, resolved: boolean) {
    return this.withStored(th, (t) => {
      t.resolved = resolved;
      th.collapsibleState = resolved ? vscode.CommentThreadCollapsibleState.Collapsed : vscode.CommentThreadCollapsibleState.Expanded;
    });
  }

  private async deleteThread(th: vscode.CommentThread) {
    if (!this.byThread.get(th)) {
      th.dispose();
      return;
    }
    const ok = await vscode.window.showWarningMessage("Delete this comment thread?", { modal: true }, "Delete");
    if (ok !== "Delete") return;
    await this.withStored(th, (t, r) => {
      r.data.threads = r.data.threads.filter((x) => x !== t);
    });
  }

  private async deleteComment(c: NoteComment) {
    const th = c.parent;
    await this.withStored(th, (t, r) => {
      t.comments = t.comments.filter((x) => x.id !== c.stored.id);
      th.comments = th.comments.filter((x) => x !== c);
      if (t.comments.length === 0) r.data.threads = r.data.threads.filter((x) => x !== t);
    });
  }

  private setMode(c: NoteComment, mode: vscode.CommentMode) {
    const th = c.parent;
    th.comments = th.comments.map((x) => {
      if (x === c) x.mode = mode;
      return x;
    });
  }

  private async saveEdit(c: NoteComment) {
    const text = typeof c.body === "string" ? c.body : c.body.value;
    await this.withStored(c.parent, (t) => {
      const s = t.comments.find((x) => x.id === c.stored.id);
      if (!s) return;
      s.body = text;
      s.edited = new Date().toISOString();
      c.savedBody = text;
      c.body = new vscode.MarkdownString(text);
    });
    this.setMode(c, vscode.CommentMode.Preview);
  }

  dispose() {
    this.subs.forEach((s) => s.dispose());
  }
}
