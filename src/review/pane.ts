import * as vscode from "vscode";
import { Change, kindOf } from "./diff";

export interface PaneChange {
  uri: string;
  curStart: number;
  curEnd: number;
  kind: "insert" | "delete" | "replace";
  line: number;
  deleted: string;
  inserted: string;
  /** Lines around the change, for context. */
  before: string;
  after: string;
}

export interface PaneThread {
  uri: string;
  id: string;
  line: number;
  quote: string;
  resolved: boolean;
  comments: { author: string; body: string; when: string }[];
}

export interface PaneState {
  tracking: boolean;
  threads: PaneThread[];
  /** Whether text is selected in the editor (a comment goes on it). */
  hasSelection: boolean;
  file?: string;
  changes: PaneChange[];
  /** Index of the change at the cursor, or -1. */
  current: number;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

export function paneChange(doc: vscode.TextDocument, c: Change): PaneChange {
  const text = doc.getText();
  const ls = text.lastIndexOf("\n", c.curStart - 1) + 1;
  let le = text.indexOf("\n", c.curEnd);
  if (le < 0) le = text.length;
  return {
    uri: doc.uri.toString(),
    curStart: c.curStart,
    curEnd: c.curEnd,
    kind: kindOf(c),
    line: doc.positionAt(c.curStart).line + 1,
    deleted: clip(c.deleted, 600),
    inserted: clip(c.inserted, 600),
    before: clip(text.slice(Math.max(ls, c.curStart - 60), c.curStart), 60),
    after: clip(text.slice(c.curEnd, Math.min(le, c.curEnd + 60)), 60),
  };
}

/**
 * The review pane: every tracked change as a card with green Accept and red
 * Reject, like the margin of a Word document. It lives in the secondary side
 * bar, to the right of the text.
 */
export class ReviewPane implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private last: PaneState = { tracking: false, threads: [], hasSelection: false, changes: [], current: -1 };

  constructor(private run: (msg: { type: string; change?: PaneChange; thread?: string; text?: string }) => void) {}

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = html(view.webview.cspSource);
    view.webview.onDidReceiveMessage((m) => (m?.type === "ready" ? this.post() : this.run(m)));
    view.onDidChangeVisibility(() => view.visible && this.post());
  }

  show(state: PaneState) {
    this.last = state;
    this.post();
  }

  private post() {
    void this.view?.webview.postMessage({ type: "state", state: this.last });
  }
}

export function html(csp: string): string {
  const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { padding: 6px 8px; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); }
  .bar { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; align-items: center; }
  .bar .count { flex: 1; color: var(--vscode-descriptionForeground); }
  button { font: inherit; border: none; border-radius: 4px; padding: 3px 9px; cursor: pointer; color: #fff; }
  button.ok { background: #2e9e44; } button.ok:hover { background: #258a3a; }
  button.no { background: #d32f2f; } button.no:hover { background: #b71c1c; }
  button.plain { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .card { border: 1px solid var(--vscode-panel-border, #8884); border-left: 4px solid #e08a00; border-radius: 5px; padding: 6px 8px; margin-bottom: 7px; cursor: pointer; }
  .card.insert { border-left-color: #2e9e44; } .card.delete { border-left-color: #d32f2f; }
  .card.current { outline: 2px solid var(--vscode-focusBorder); }
  .head { display: flex; justify-content: space-between; color: var(--vscode-descriptionForeground); font-size: 0.9em; margin-bottom: 3px; }
  .text { font-family: var(--vscode-editor-font-family); font-size: 0.95em; white-space: pre-wrap; word-break: break-word; }
  .ctx { color: var(--vscode-descriptionForeground); }
  del { color: var(--vscode-latexReview-deletedForeground, #d32f2f); }
  ins { color: var(--vscode-latexReview-insertedForeground, #1a56c9); text-decoration: underline; }
  .acts { display: flex; gap: 6px; margin-top: 6px; }
  .empty { color: var(--vscode-descriptionForeground); line-height: 1.5; }
  h3 { font-size: 0.85em; text-transform: uppercase; letter-spacing: .04em; color: var(--vscode-descriptionForeground); margin: 14px 0 6px; font-weight: 600; }
  textarea { width: 100%; box-sizing: border-box; font: inherit; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #8884); border-radius: 4px; padding: 4px 6px; resize: vertical; min-height: 2.4em; }
  button.note { background: #c79200; } button.note:hover { background: #a87b00; }
  button:disabled { opacity: .5; cursor: default; }
  .thread { border: 1px solid var(--vscode-panel-border, #8884); border-left: 4px solid #f5c518; border-radius: 5px; padding: 6px 8px; margin-bottom: 7px; }
  .thread.resolved { opacity: .6; border-left-color: #888; }
  .quote { font-family: var(--vscode-editor-font-family); font-size: .9em; color: var(--vscode-descriptionForeground); cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .msg { margin-top: 5px; } .msg b { font-weight: 600; } .msg .when { color: var(--vscode-descriptionForeground); font-size: .85em; margin-left: 4px; }
  .body { white-space: pre-wrap; word-break: break-word; }
  .tacts { display: flex; gap: 6px; margin-top: 6px; align-items: flex-start; }
  .tacts textarea { flex: 1; min-height: 1.9em; }
  .link { background: none; color: var(--vscode-textLink-foreground); padding: 2px 4px; }
</style></head><body>
<div id="root"></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const root = document.getElementById("root");
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const vis = (s) => esc(s).replace(/\\n/g, "↵\\n");
  const label = { insert: "Added", delete: "Deleted", replace: "Changed" };
  function render(st) {
    const draft = document.getElementById("new") ? document.getElementById("new").value : "";
    root.innerHTML = renderChanges(st) + renderComments(st);
    const n = document.getElementById("new");
    if (n) n.value = draft;
    const cur = root.querySelector(".card.current");
    if (cur) cur.scrollIntoView({ block: "nearest" });
  }
  function renderComments(st) {
    let h = '<h3>Comments</h3><textarea id="new" placeholder="' + (st.hasSelection ? "Comment on the selected text…" : "Select text in the document, then write a comment…") + '"></textarea>' +
      '<div class="bar" style="margin-top:4px"><button class="note" data-a="comment">Add comment</button></div>';
    if (!st.threads.length) return h + '<p class="empty">No comments yet.</p>';
    for (const t of st.threads) {
      h += '<div class="thread' + (t.resolved ? " resolved" : "") + '"><div class="head"><span class="quote" data-a="showThread" data-t="' + t.id + '">“' + esc(t.quote || "…") + '”</span><span>line ' + t.line + '</span></div>';
      for (const c of t.comments) h += '<div class="msg"><b>' + esc(c.author) + '</b><span class="when">' + esc(c.when) + '</span><div class="body">' + esc(c.body) + '</div></div>';
      h += '<div class="tacts">' + (t.resolved ? '<button class="link" data-a="reopen" data-t="' + t.id + '">Reopen</button>' :
        '<textarea data-reply="' + t.id + '" placeholder="Reply…"></textarea><button class="plain" data-a="reply" data-t="' + t.id + '">Reply</button><button class="ok" data-a="resolve" data-t="' + t.id + '" title="Resolve">✓</button>') +
        '<button class="link" data-a="deleteThread" data-t="' + t.id + '" title="Delete">Delete</button></div></div>';
    }
    return h;
  }
  function renderChanges(st) {
    if (!st.tracking) {
      return '<h3>Changes</h3><p class="empty">Changes are not tracked in this document.</p><div class="bar"><button class="ok" data-a="start">Start tracking changes</button></div>';
    }
    const n = st.changes.length;
    let h = '<h3>Changes</h3><div class="bar"><span class="count">' + (n ? n + (n === 1 ? " change" : " changes") : "No changes yet") + '</span>';
    if (n) h += '<button class="ok" data-a="acceptAll">Accept all</button><button class="no" data-a="rejectAll">Reject all</button>';
    h += '<button class="plain" data-a="stop" title="Stop tracking changes">Stop</button></div>';
    if (!n) h += '<p class="empty">Edit the document: each change shows up here to accept or reject.</p>';
    st.changes.forEach((c, i) => {
      h += '<div class="card ' + c.kind + (i === st.current ? " current" : "") + '" data-i="' + i + '">' +
        '<div class="head"><span>' + label[c.kind] + '</span><span>line ' + c.line + '</span></div>' +
        '<div class="text"><span class="ctx">' + vis(c.before) + '</span>' +
        (c.deleted ? '<del>' + vis(c.deleted) + '</del>' : '') + (c.inserted ? '<ins>' + vis(c.inserted) + '</ins>' : '') +
        '<span class="ctx">' + vis(c.after) + '</span></div>' +
        '<div class="acts"><button class="ok" data-a="accept" data-i="' + i + '">✓ Accept</button><button class="no" data-a="reject" data-i="' + i + '">✕ Reject</button></div></div>';
    });
    return h;
  }
  let state = { tracking: false, threads: [], hasSelection: false, changes: [], current: -1 };
  window.addEventListener("message", (e) => {
    if (e.data.type !== "state") return;
    state = e.data.state;
    // Do not redraw under someone typing a reply.
    const a = document.activeElement;
    if (a && a.tagName === "TEXTAREA" && a.value) return;
    render(state);
  });
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button, .quote");
    const card = e.target.closest(".card");
    if (b && b.dataset.t) {
      const box = root.querySelector('textarea[data-reply="' + b.dataset.t + '"]');
      vscode.postMessage({ type: b.dataset.a, thread: b.dataset.t, text: box ? box.value : undefined });
    } else if (b && b.dataset.a === "comment") {
      const box = document.getElementById("new");
      if (box.value.trim()) { vscode.postMessage({ type: "comment", text: box.value }); box.value = ""; }
    } else if (b) {
      const i = b.dataset.i;
      vscode.postMessage({ type: b.dataset.a, change: i !== undefined ? state.changes[+i] : undefined });
    } else if (card) {
      vscode.postMessage({ type: "reveal", change: state.changes[+card.dataset.i] });
    }
  });
  vscode.postMessage({ type: "ready" });
</script></body></html>`;
}
