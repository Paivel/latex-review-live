import * as vscode from "vscode";

/** Documents this extension itself is editing (accept/reject), which live preview must not undo. */
const busy = new Set<string>();

export async function applyOwnEdit(uri: vscode.Uri, edit: vscode.WorkspaceEdit): Promise<boolean> {
  const k = uri.toString();
  busy.add(k);
  try {
    return await vscode.workspace.applyEdit(edit);
  } finally {
    busy.delete(k);
  }
}

export function isOwnEdit(uri: vscode.Uri): boolean {
  return busy.has(uri.toString());
}
