# LaTeX Review and Live Preview

Two things LaTeX in VS Code is missing, in one extension:

1. **Review mode**: track changes as in Word, accept or reject each change, and comment on the text.
2. **Live preview**: an Obsidian-style mode in the normal editor where LaTeX code is hidden and the text stays editable. Switch between it and the source with one click.

Your `.tex` file always stays plain LaTeX. It builds with LaTeX Workshop as before, and SyncTeX keeps working.

## Review mode

Click **Track changes** in the status bar (or run *LaTeX Review: Start Tracking Changes*). From then on:

- inserted text is blue and underlined, deleted text is shown in red, struck through, where it was;
- a mark in the left margin shows each changed line (green: added, red: deleted, orange: rewritten);
- **Accept / Reject** above each changed line;
- the **Review** pane (its icon in the activity bar; drag it to the right side bar to keep it beside the text) shows every change as a card with a green **Accept** and a red **Reject**, plus Accept All and Reject All; the change at the cursor is outlined, and clicking a card jumps to it;
- each change also has Accept / Reject in its hover and in the lightbulb (`Ctrl+.` / `Cmd+.`); select a passage to accept or reject all changes in it.
- `Ctrl+Alt+]` / `Ctrl+Alt+[` (`Cmd+Alt+]` / `Cmd+Alt+[` on Mac) go to the next or previous change.

**Comments**: select text, write in the Comments box of the Review pane and click Add comment; reply, resolve and delete there too. Or press `Ctrl+Alt+M` (`Cmd+Alt+M`), or click `+` in the gutter. Threads take replies, can be resolved, edited and deleted. Commented text is highlighted.

**Export Marked-Up Copy** (in the view's `…` menu) writes `name-review.tex` with the changes as `\added`, `\deleted` and `\replaced` and comments as `\comment` from the [changes](https://ctan.org/pkg/changes) package, so co-authors without VS Code can read the review in the PDF.

The review is kept beside the document in `.latex-review/<name>.tex.json`: the text changes are measured against, and the comments. It is written when you save the document, so the two always match. Commit it to share a review through git, or add `.latex-review/` to `.gitignore` to keep it private.

## Live preview

Click **Source** in the status bar, the eye button in the editor title, or press `Ctrl+Alt+P` (`Cmd+Alt+P`).

| You write | You see |
|---|---|
| `\textbf{x}`, `\emph{x}`, `\underline{x}` | **x**, *x*, x underlined |
| `\section{Intro}` | **Intro** as a heading |
| `\cite{a,b,c}`, `\ref{fig:x}`, `\cref{fig:x}` | [1–3], 2, fig. 2 (numbers from the last build's .aux) |
| `$\alpha \to \beta^2$`, `\frac{a}{b}` | α → β², a/b |
| `\ce{SO4^2-}`, `\SI{5}{\milli\gram\per\milli\litre}` | SO₄²⁻, 5 mg/mL |
| `\item`, `` ``q'' ``, `--`, `~`, `\%` | •, “q”, –, non-breaking space, % |
| `\begin{figure}`, `\end{itemize}` | shown as they are, dimmed |
| `\footnote{…}`, `\label{key}` | [ … ] dimmed, 🏷 key |
| `\includegraphics{s}`, `\caption{…}` | 🖼 s, Caption: … |

Lines that hold only code (`\label`, `\begin{itemize}`, `\centering`, comments, the preamble) are folded away; the line the cursor is on always stays open. Turn this off with `latexReview.livePreview.foldCode`.

The preamble and anything after `\end{document}` are read-only in live preview (`latexReview.livePreview.protectPreamble`); switch to Source to edit them.

Code stays hidden while you type, as in Word: a click next to a command puts the cursor inside its braces, so you type its argument (a caption, a label) at once. The cursor steps over hidden code in one go, and typing or deleting cannot cut into it. Set `latexReview.livePreview.reveal` to `element` to see the code of the command the cursor is in, as in Obsidian, or to `line`. `latexReview.livePreview.reveal` switches this to the whole line, or off. The preamble and commands it does not know are left as source. Display math is coloured and its symbols replaced, but it is not typeset.

## Settings

| Setting | Default | |
|---|---|---|
| `latexReview.author` | git `user.name` | Your name on comments |
| `latexReview.codeLens` | `true` | Accept / Reject above lines with changes |
| `latexReview.livePreview.default` | `false` | Open LaTeX documents in live preview |
| `latexReview.livePreview.reveal` | `never` | `never`, `element` or `line` |
| `latexReview.livePreview.foldCode` | `true` | Fold lines that hold only code |
| `latexReview.livePreview.protectPreamble` | `true` | Preamble read-only in live preview |

Colours (inserted, deleted, comment, heading, math, references) can be changed under `workbench.colorCustomizations`, e.g. `"latexReview.insertedForeground": "#1a56c9"`.

## Limits

- A change is any difference from the text tracking started with, measured word by word. Changes have no author, and undoing an *Accept* does not bring the change back.
- Live preview works by hiding text in the editor, so the cursor still steps over hidden characters one by one, and lines keep the editor's font.
