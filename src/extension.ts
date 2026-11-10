import * as vscode from "vscode";
import { ReviewStore, TrackChanges } from "./review/review";
import { Comments } from "./review/comments";
import { LivePreview } from "./preview/livePreview";

export function activate(context: vscode.ExtensionContext) {
  const store = new ReviewStore();
  context.subscriptions.push(store, new TrackChanges(store), new Comments(store), new LivePreview(context.workspaceState));
}

export function deactivate() {}
