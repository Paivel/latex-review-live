import { registerFormat } from "./format/format";
import * as vscode from "vscode";
import { ReviewStore, TrackChanges } from "./review/review";
import { Comments } from "./review/comments";
import { LivePreview } from "./preview/livePreview";
import { AutoBib } from "./bib/autoBib";
import { VisualEditor } from "./visual/visualEditor";

export function activate(context: vscode.ExtensionContext) {
  const store = new ReviewStore();
  context.subscriptions.push(store, new TrackChanges(store, context.extensionUri), new Comments(store), new LivePreview(context.workspaceState), new AutoBib(), registerFormat(), new VisualEditor(store, context.extensionUri, context.globalStorageUri));
}

export function deactivate() {}
