import * as vscode from "vscode";
import { toggleWrap } from "./wrap";

const CMDS: Record<string, string> = { bold: "textbf", italic: "textit", underline: "underline" };

/** latexReview.formatSource: Cmd+B / Cmd+I / Cmd+U in a LaTeX editor. */
export function registerFormat(): vscode.Disposable {
  return vscode.commands.registerTextEditorCommand("latexReview.formatSource", async (ed, _e, which: string) => {
    const cmd = CMDS[which];
    if (!cmd) return;
    const doc = ed.document;
    // One selection at a time, from the last, so earlier offsets stay right.
    const sels = [...ed.selections].sort((a, b) => doc.offsetAt(b.start) - doc.offsetAt(a.start));
    const out: vscode.Selection[] = [];
    for (const s of sels) {
      const text = doc.getText();
      const w = toggleWrap(text, cmd, doc.offsetAt(s.start), doc.offsetAt(s.end));
      await ed.edit((b) => b.replace(new vscode.Range(doc.positionAt(w.start), doc.positionAt(w.end)), w.text));
      out.push(new vscode.Selection(doc.positionAt(w.selStart), doc.positionAt(w.selEnd)));
    }
    ed.selections = out;
  });
}
