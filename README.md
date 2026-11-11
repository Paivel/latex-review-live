# LaTeX Review and Visual Editor

Two things LaTeX in VS Code is missing, in one extension:

1. **Review mode**: track changes as in Word, accept or reject each change, and comment on the text.
2. **Visual editor**: the document drawn like the PDF in a tab beside the source, and edited there.

Your `.tex` file always stays plain LaTeX. It builds with LaTeX Workshop as before, and SyncTeX keeps working.

## Review mode

Click **Track changes** in the status bar (or run *LaTeX Review: Start Tracking Changes*). From then on:

- inserted text is blue and underlined, deleted text is shown in red, struck through, where it was;
- a mark in the left margin shows each changed line (green: added, red: deleted, orange: rewritten);
- the **Review** pane (its icon in the activity bar; drag it to the right side bar to keep it beside the text) shows every change as a card with a green **Accept** and a red **Reject**, plus Accept All and Reject All; the change at the cursor is outlined, and clicking a card jumps to it;
- each change also has Accept / Reject in its hover and in the lightbulb (`Ctrl+.` / `Cmd+.`); select a passage to accept or reject all changes in it.
- `Ctrl+Alt+]` / `Ctrl+Alt+[` (`Cmd+Alt+]` / `Cmd+Alt+[` on Mac) go to the next or previous change.

**Comments**: select text, write in the Comments box of the Review pane and click Add comment; reply, resolve and delete there too. Or press `Ctrl+Alt+M` (`Cmd+Alt+M`), or click `+` in the gutter. Threads take replies, can be resolved, edited and deleted. Commented text is highlighted.

**Export Marked-Up Copy** (in the view's `…` menu) writes `name-review.tex` with the changes as `\added`, `\deleted` and `\replaced` and comments as `\comment` from the [changes](https://ctan.org/pkg/changes) package, so co-authors without VS Code can read the review in the PDF.

The review is kept beside the document in `.latex-review/<name>.tex.json`: the text changes are measured against, and the comments. It is written when you save the document, so the two always match. Commit it to share a review through git, or add `.latex-review/` to `.gitignore` to keep it private.

## Visual editor

**LaTeX Review: Open Visual Editor** (Cmd+Alt+V, or the eye button in the editor title bar) opens the document in a tab beside the source, drawn like the PDF, where you edit it directly:

- Paragraphs and headings are typed like in a word processor. Enter starts a new paragraph, Backspace at the start of one joins it to the one before, Cmd+B, Cmd+I and Cmd+U make bold, italic and underlined text (`\textbf`, `\textit`, `\underline` in the source).
- Equations are drawn with KaTeX (with mhchem's `\ce`); click one to edit its source with a live preview.
- `\cite`, `\ref` and compound labels show their numbers from the last build (the `.aux`). Click one, or any other command shown in purple, to edit its source.
- Figures show their picture (`\includegraphics`, or the PDF beside an `\input` drawing), with the caption and the label editable under it; a missing caption or label is added when you type one. Double-click the picture to edit the drawing in Reactio Draw.
- Tracked changes are shown in blue (added) and red (deleted); click one for Accept or Reject.
- The preamble, lists and anything else that is not drawn stay as editable source in grey boxes.

Every edit goes straight into the `.tex`; the source and the visual editor scroll to each other, and double-clicking text shows it in the source.

In the `.tex` editor too, Cmd+B, Cmd+I and Cmd+U wrap the selection in `\textbf{}`, `\textit{}` or `\underline{}`, and take it out again.

## Bibliography from Zotero

Insert citations with any picker (for example Citation Picker for Zotero, set to `format=latex`). When a `\cite{key}` is not in the `.bib` file named by `\bibliography{refs}` or `\addbibresource{refs.bib}`, the extension asks Zotero for it through Better BibTeX and appends the entry (the file is created if needed). It runs on save and about a second after the set of cited keys changes. Zotero with Better BibTeX must be running. Run **LaTeX Review: Update Bibliography from Zotero** to do it by hand.

## Settings

| Setting | Default | |
|---|---|---|
| `latexReview.author` | git `user.name` | Your name on comments |

Colours (inserted, deleted, comment) can be changed under `workbench.colorCustomizations`, e.g. `"latexReview.insertedForeground": "#1a56c9"`.

## Limits

- A change is any difference from the text tracking started with, measured word by word. Changes have no author, and undoing an *Accept* does not bring the change back.
