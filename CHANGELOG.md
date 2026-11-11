# Changelog

## 0.4.1

- Visual editor: closer to the article class in the PDF: a regular-weight title, author and date at \large, a smaller abstract, no blank gap between paragraphs, and -- / --- / `` '' drawn as dashes and curly quotes (the source keeps them as typed).
- Track changes: a deleted piece stays where it was. Changes are now updated from each edit instead of re-diffing the whole file, which could show the deletion next to an earlier blank line or repeated word.

## 0.4.0

- Visual editor: lists (itemize, enumerate, description) are drawn as lists, nested too; each item is edited in place, and Enter at an item starts a new \item.
- Visual editor: \maketitle shows the title, authors and date from the preamble, editable; the abstract is drawn as an abstract.
- Visual editor: theorem-like environments (theorem, lemma, definition…, and your own \newtheorem) and proofs are drawn with their title and number.
- Visual editor: \includegraphics[width=0.5\linewidth] (or a width in cm/pt, or scale=) sets the picture's size as in the PDF.
- Visual editor: \cref, \Cref and \autoref show the kind as LaTeX prints it ("fig. 1", "Figure 1", "Equation (2)").
- Visual editor: \input and \include lines show as chips; click one to open the file.
- Visual editor: Cmd+Z and Cmd+Shift+Z undo and redo through the .tex file's own history, shared with the text editor.

## 0.3.7

- Visual editor: after clicking an equation and leaving it unchanged, it is drawn as before (with the document's number), and no scroll bar is left under it.

## 0.3.6

- Visual editor: \bibliographystyle and \bibliography lines are hidden behind the reference list, as in the PDF; click "References" to show or hide them.

## 0.3.5

- Visual editor: clicking a compound label on a picture copies its \rcmpd{..} at once; the box that opens keeps Insert.

## 0.3.4

- Visual editor: formulas use the macros the preamble defines (\newcommand, \renewcommand, \providecommand, \DeclareMathOperator, \def); drawn formulas are cached, so long documents redraw fast.
- Visual editor: \ce{..} and \pu{..} in running text are drawn with mhchem.
- Visual editor: a whole LaTeX command typed or pasted into the text (\rcmpd{1}, \cite{key}, \ce{H2O}) and $..$ math stay LaTeX instead of being escaped.
- Visual editor: compound labels on Reactio pictures can be clicked: copy their \rcmpd{..}, or insert it at the caret.

## 0.3.3

- Visual editor: a deleted paragraph and the paragraph after it keep their first-line indent.

## 0.3.2

- Visual editor: a deleted paragraph (tracked) is shown struck through where it was, with Accept and Reject on click.
- Visual editor: Cmd+B, Cmd+I and Cmd+U now reach the page instead of moving VS Code's side bar and panels.

## 0.3.1

- Security: in a folder VS Code does not trust (Restricted Mode), citations are not fetched from Zotero by themselves and PDF figures are not handed to Quick Look or pdftoppm; the page draws them with pdf.js.
- Security: the Zotero server address can only be set in your own settings, not by a project's .vscode/settings.json.
- Security: the visual editor page runs only its own scripts (not scripts from the workspace folders it shows pictures from), and double-clicking a figure opens only that figure's files.

## 0.3.0

- Live preview (the mode that hid LaTeX code in the editor) is removed: the visual editor replaces it. Its settings, colours, the eye button and Cmd+Alt+P are gone.
- The visual editor's button is now an eye (the book looked like Split Editor).
- Renamed to "LaTeX Review and Visual Editor".

## 0.2.6

- Cmd+B, Cmd+I and Cmd+U (Ctrl on Windows and Linux) in a .tex editor wrap the selection in \textbf{..}, \textit{..} or \underline{..}; with the caret or selection already inside one, they take it out again. With no selection they insert an empty group.

## 0.2.5

- Visual editor: Cmd+B, Cmd+I and Cmd+U (Ctrl on Windows and Linux) make the selected text bold, italic or underlined; the source gets \textbf, \textit or \underline. Pressing again removes it.
- Visual editor: Reactio Draw labels sit on their baseline, as in the PDF.

## 0.2.4

- Visual editor: figures are shown at their natural size, as LaTeX sets them (1:1, never wider than the line), scaled with the document's font size.
- Visual editor: the compound numbers and text Reactio Draw sets over a drawing are shown on it.
- Visual editor: the reference list also shows for achemso (mcitethebibliography).

## 0.2.3

- Visual editor: edits are written to the file again after the file was closed and reopened.
- Visual editor: PDF figures are sent to the page as pictures, so they show in VS Code (the page could not load them from the extension's storage). While a picture is being drawn the figure says so.
- Visual editor: double-click text to show that place in the source, selected.
- Visual editor: problems in the page are written to .latex-review/visual-log.txt beside the document.

## 0.2.1

- Visual editor: PDF figures (Reactio Draw drawings) are drawn by the system (Quick Look on macOS, pdftoppm elsewhere), so they show without the PDF reader in the page.
- Visual editor: the reference list from the last build (the .bbl) is shown under \bibliography.

## 0.2.0

- Visual editor (Cmd+Alt+V, or the book button above a .tex file): the document drawn like the PDF in a tab beside the source, and edited there. Paragraphs, headings, bold and italic are typed in place; equations are drawn with KaTeX and edited by clicking; \cite, \ref and compound numbers show their numbers from the last build; figures show their picture (PDF, PNG, JPG, SVG) with the caption and label editable under it. Double-click a figure to edit its drawing in Reactio Draw. Tracked changes show in blue and red, with Accept and Reject on click. The source and the visual editor follow each other.

## 0.1.15

- Bibliography from Zotero: a \cite key that is missing from the .bib named by \bibliography or \addbibresource is fetched from Zotero (Better BibTeX) and appended. Runs on save and shortly after you add a citation; also "LaTeX Review: Update Bibliography from Zotero".

## 0.1.14

- No more Accept / Reject above lines (and no setting for it): the Review pane, the hover and Cmd+. have them.

## 0.1.13

- Accept / Reject above lines is off by default: the Review pane has them.

## 0.1.12

- The Review pane opens from its own icon in the activity bar (it can be dragged to the right side bar).

## 0.1.11

- Back to ✓ Accept and ✗ Reject above changed lines.

## 0.1.9

- Back to plain Accept / Reject above changed lines (on by default); the marks at the end of lines are gone.

## 0.1.8

- ✅ / ❌ at the end of a line: Cmd/Ctrl+click, or hover and click the link.

## 0.1.7

- Live preview: a click by a command puts the cursor inside its braces, so its argument is typed at once.
- Live preview: \\label keys stay in view (🏷 key) and can be edited; only the command and braces are hidden.
- Live preview keeps code hidden under the cursor by default, as in Word (`latexReview.livePreview.reveal`: `never`; `element` is the Obsidian way).

## 0.1.6

- ✅ Accept and ❌ Reject at the end of each changed line, clickable (`latexReview.lineButtons`).

## 0.1.5

- Live preview: \\begin{…} and \\end{…} always stay in view (dimmed).
- Live preview: the cursor steps over hidden code in one go and typing or deleting can no longer cut into it, as with Obsidian's atomic ranges. The code of the command the cursor is inside still shows.

## 0.1.4

- Review pane on the right: each change as a card with green Accept and red Reject; the change at the cursor is outlined.
- Accept / Reject above lines is now off by default (`latexReview.codeLens`).
- Comments in the same pane: write one on the selected text, reply, resolve, reopen, delete.

## 0.1.3

- Live preview keeps the preamble and anything after \end{document} read-only; switch to Source to edit them.

## 0.1.2

- Double and triple click work again in live preview: code under a click is shown only once the clicking is over.
- With the cursor in a block of code lines, only its line opens; the rest stays folded.

## 0.1.1

- Accept and Reject in green and red, and a mark in the margin on each changed line.
- Live preview folds away lines that hold only code; the cursor's line stays open.

## 0.1.0

- Track changes with accept and reject per change, by selection or all at once, and a list of changes.
- Comment threads with replies, resolve, edit and delete.
- Export a marked-up copy with the changes package.
- Live preview that hides LaTeX code in the editor, with references and citations from the .aux.
