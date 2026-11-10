# Changelog

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
