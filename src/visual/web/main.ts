// The visual editor page. Runs in the webview.
import { escapeText } from "../inline";
import type { MNode, VBlock, VDoc } from "../model";

declare const acquireVsCodeApi: () => { postMessage(m: unknown): void };
declare const katex: { render(tex: string, el: HTMLElement, opts: object): void; renderToString(tex: string, opts: object): string };
declare global { interface Window { PDFJS_URL: string; PDFJS_WORKER: string } }

const vscode = acquireVsCodeApi();
const page = document.getElementById("page")!;
const bar = document.getElementById("bar")!;
let doc: VDoc | null = null;
/** Source offset (relative to its block) of each rendered text node. */
const textAt = new WeakMap<Node, number>();
/** Latest block data for each block element. */
const blockOf = new WeakMap<HTMLElement, VBlock>();
let pendingFocus: number | null = null;
let stale = new Set<HTMLElement>();

// ---------------------------------------------------------------- rendering

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderMath(tex: string, target: HTMLElement, display: boolean) {
  try {
    katex.render(tex, target, { displayMode: display, throwOnError: false, strict: "ignore", trust: false });
  } catch {
    target.textContent = tex;
    target.classList.add("raw");
  }
}

function renderNodes(parent: HTMLElement, nodes: MNode[], base: number) {
  for (const n of nodes) {
    if (n.t === "text") {
      const t = document.createTextNode(n.s);
      textAt.set(t, n.at - base);
      if (n.ins !== undefined) {
        const s = el("span", "ins");
        s.dataset.c = String(n.ins);
        s.appendChild(t);
        parent.appendChild(s);
      } else parent.appendChild(t);
    } else if (n.t === "del") {
      const s = el("span", "del", n.s);
      s.contentEditable = "false";
      s.dataset.c = String(n.c);
      parent.appendChild(s);
    } else if (n.t === "fmt") {
      const tag = n.cmd === "textbf" ? "b" : n.cmd === "textit" || n.cmd === "emph" || n.cmd === "textsl" ? "i" : n.cmd === "underline" ? "u" : n.cmd === "texttt" ? "code" : "span";
      const f = el(tag as "b", "fmt " + n.cmd);
      f.dataset.cmd = n.cmd;
      renderNodes(f, n.kids, base);
      parent.appendChild(f);
    } else {
      const a = el("span", "atom " + n.kind);
      a.contentEditable = "false";
      a.dataset.src = n.src;
      a.dataset.kind = n.kind;
      if (n.ins !== undefined) { a.classList.add("ins"); a.dataset.c = String(n.ins); }
      drawAtom(a, n.kind, n.show, n.tex, n.src);
      parent.appendChild(a);
    }
  }
}

function drawAtom(a: HTMLElement, kind: string, show: string | undefined, tex: string | undefined, src: string) {
  a.textContent = "";
  if (kind === "math" && tex !== undefined) renderMath(tex, a, false);
  else if (kind === "cite") {
    if (doc?.superCites) a.appendChild(el("sup", "", show ?? "?"));
    else a.textContent = `[${show ?? "?"}]`;
  } else if (kind === "comment") { a.textContent = "%"; a.title = src; }
  else a.textContent = show ?? src;
  if (kind === "cmd" && show === src) a.classList.add("raw");
}

function editable(e: HTMLElement, start: number, end: number, src: string, kind: string) {
  e.contentEditable = "true";
  e.spellcheck = true;
  e.classList.add("region");
  e.dataset.start = String(start);
  e.dataset.end = String(end);
  e.dataset.src = src;
  e.dataset.region = kind;
}

function renderBlock(b: VBlock): HTMLElement {
  const box = el("div", `block ${b.kind}`);
  box.dataset.start = String(b.start);
  box.dataset.end = String(b.end);
  box.dataset.bsrc = b.src;
  if (b.changed) box.classList.add("changed");
  blockOf.set(box, b);
  switch (b.kind) {
    case "preamble": {
      const d = el("details", "pre");
      d.appendChild(el("summary", "", `Preamble · ${b.src.split("\n").length - 1} lines`));
      const pre = el("pre", "code");
      pre.textContent = b.src;
      editable(pre, b.start, b.end, b.src, "code");
      pre.contentEditable = "plaintext-only";
      d.appendChild(pre);
      box.appendChild(d);
      break;
    }
    case "heading": {
      const h = el(b.level !== undefined && b.level <= 2 ? "h1" : b.level === 3 ? "h2" : b.level === 4 ? "h3" : "h4");
      if (b.num) h.appendChild(Object.assign(el("span", "num", b.num), { contentEditable: "false" }));
      const t = el("span", "title");
      renderNodes(t, b.title!.nodes, b.title!.start);
      editable(t, b.title!.start, b.title!.end, doc ? sliceOf(b, b.title!.start, b.title!.end) : "", "inline");
      h.appendChild(t);
      box.appendChild(h);
      break;
    }
    case "para": {
      const p = el("p");
      renderNodes(p, b.nodes!, b.start);
      editable(p, b.start, b.end, b.src, "inline");
      box.appendChild(p);
      break;
    }
    case "figure": {
      const f = b.fig!;
      const pics = el("div", "pics");
      if (!f.images.length) pics.appendChild(el("div", "missing", "This figure has no picture."));
      for (const im of f.images) {
        if (im.pending) { pics.appendChild(el("div", "missing", `Drawing ${im.name}…`)); continue; }
        if (!im.uri) { pics.appendChild(el("div", "missing", `No picture found for ${im.name}`)); continue; }
        const pic = el("div", "pic");
        // As LaTeX sets it: natural size (1:1), never wider than the line.
        const em = (pt: number) => `${pt / (doc?.fontPt ?? 10)}em`;
        if (im.widthPt) pic.style.width = em(im.widthPt);
        pic.title = "Double-click to edit the drawing";
        pic.addEventListener("dblclick", (e) => { e.preventDefault(); vscode.postMessage({ type: "editFigure", file: im.file, entry: im.entry }); });
        pics.appendChild(pic);
        if (im.pdf) {
          const holder = el("div", "pdf");
          pic.appendChild(holder);
          void drawPdf(im.uri, holder);
        } else {
          const img = el("img");
          img.src = im.uri.startsWith("png:") ? pictureData.get(im.uri.slice(4)) ?? "" : im.uri;
          img.alt = im.name;
          pic.appendChild(img);
          for (const l of im.labels ?? []) {
            const t = el("span", "plabel");
            t.style.left = `${l.x * 100}%`;
            t.style.bottom = `${l.y * 100}%`;
            t.style.fontSize = em(l.size);
            renderNodes(t, l.nodes ?? [], 0);
            t.querySelectorAll(".atom").forEach((a) => { (a as HTMLElement).style.pointerEvents = "none"; });
            pic.appendChild(t);
          }
        }
      }
      box.appendChild(pics);
      const cap = el("div", "caption");
      cap.appendChild(Object.assign(el("b", "num", `${f.env[0].toUpperCase()}${f.env.slice(1)} ${f.num}. `), { contentEditable: "false" }));
      const text = el("span", "captext");
      if (f.caption) {
        renderNodes(text, f.caption.nodes, f.caption.start);
        editable(text, f.caption.start, f.caption.end, sliceOf(b, f.caption.start, f.caption.end), "inline");
      } else {
        text.contentEditable = "true";
        text.dataset.placeholder = "Add a caption…";
        text.dataset.field = "caption";
        text.classList.add("region", "empty");
      }
      text.dataset.fig = String(f.start);
      cap.appendChild(text);
      box.appendChild(cap);
      const lab = el("div", "label");
      lab.appendChild(el("span", "", "label "));
      const inp = el("input");
      inp.value = f.label?.text ?? "";
      inp.placeholder = "fig:name";
      inp.dataset.fig = String(f.start);
      inp.spellcheck = false;
      lab.appendChild(inp);
      box.appendChild(lab);
      break;
    }
    case "math": {
      const m = el("div", "eq");
      renderMath(b.tex ?? "", m, true);
      m.title = "Click to edit";
      box.appendChild(m);
      break;
    }
    case "list":
    case "code": {
      const pre = el("pre", "code");
      pre.textContent = b.src;
      editable(pre, b.start, b.end, b.src, "code");
      pre.contentEditable = "plaintext-only";
      pre.spellcheck = false;
      box.appendChild(pre);
      if (b.bib?.length) {
        box.appendChild(el("h1", "refs", "References"));
        const list = el("div", "bib");
        for (const e of b.bib) {
          const row = el("div", "bibitem");
          row.appendChild(el("span", "biblabel", doc?.superCites ? `(${e.label})` : `[${e.label}]`));
          const t = el("span", "bibtext");
          renderNodes(t, e.nodes, 0);
          t.querySelectorAll(".atom").forEach((a) => { (a as HTMLElement).style.pointerEvents = "none"; });
          row.appendChild(t);
          list.appendChild(row);
        }
        box.appendChild(list);
      }
      break;
    }
    case "deleted": {
      // A deleted paragraph: shown struck through, Accept or Reject on click.
      const p = el("p");
      renderNodes(p, b.nodes ?? [], b.start);
      box.appendChild(p);
      break;
    }
    case "tail":
      box.hidden = true;
      break;
  }
  return box;
}

function sliceOf(b: VBlock, start: number, end: number): string {
  return b.src.slice(start - b.start, end - b.start);
}

// PNGs of PDF figures, sent once by the extension.
const pictureData = new Map<string, string>();

// PDFs drawn once per file version and copied for every use.
const pdfCache = new Map<string, Promise<HTMLCanvasElement>>();
let pdfjs: Promise<any> | null = null;
function loadPdfjs(): Promise<any> {
  pdfjs ??= (async () => {
    const lib = await import(/* @vite-ignore */ window.PDFJS_URL);
    // A module worker cannot be loaded straight from the webview's resource host; load it from a blob.
    try {
      const code = await (await fetch(window.PDFJS_WORKER)).text();
      lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    } catch {
      lib.GlobalWorkerOptions.workerSrc = window.PDFJS_WORKER;
    }
    return lib;
  })();
  return pdfjs;
}
async function drawPdf(uri: string, holder: HTMLElement) {
  try {
    let p = pdfCache.get(uri);
    if (!p) {
      p = (async () => {
        const lib = await Promise.race([loadPdfjs(), new Promise((_, no) => setTimeout(() => no(new Error("the PDF reader did not load")), 8000))]) as any;
        const d = await lib.getDocument({ url: uri, isEvalSupported: false }).promise;
        const pg = await d.getPage(1);
        const vp = pg.getViewport({ scale: 3 });
        const c = el("canvas");
        c.width = Math.ceil(vp.width);
        c.height = Math.ceil(vp.height);
        await pg.render({ canvasContext: c.getContext("2d"), viewport: vp, canvas: c }).promise;
        void (d.destroy ?? d.cleanup)?.call(d);
        return c;
      })();
      pdfCache.set(uri, p);
    }
    const src = await p;
    const c = el("canvas");
    c.width = src.width;
    c.height = src.height;
    c.style.width = holder.parentElement?.style.width ? "100%" : `${src.width / 3}px`;
    c.getContext("2d")!.drawImage(src, 0, 0);
    holder.textContent = "";
    holder.appendChild(c);
  } catch (e) {
    pdfCache.delete(uri);
    holder.textContent = `Could not draw the PDF: ${(e as Error)?.message ?? e}`;
    holder.className = "missing";
  }
}

/** Key of a block's look, without offsets: equal keys draw the same. */
function lookKey(b: VBlock): string {
  return JSON.stringify(b, (k, v) => (k === "start" || k === "end" || k === "at" || k === "curStart" || k === "curEnd" ? undefined : v));
}
const keyOf = new WeakMap<HTMLElement, string>();

function render(d: VDoc, refresh: boolean) {
  const prevDoc = doc;
  doc = d;
  bar.innerHTML = "";
  bar.appendChild(el("span", "name", d.name));
  const n = d.changes.length;
  if (d.tracking || n) bar.appendChild(el("span", "count", n ? `${n} change${n === 1 ? "" : "s"}` : "Tracking changes"));
  const src = el("button", "", "Source");
  src.onclick = () => vscode.postMessage({ type: "source" });
  bar.appendChild(src);

  const active = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(".block") ?? null;
  const old = [...page.querySelectorAll<HTMLElement>(":scope > .block")];
  const pool = new Map<string, HTMLElement[]>();
  for (const e of old) {
    if (e === active) continue;
    const k = keyOf.get(e);
    if (!k) continue;
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k)!.push(e);
  }
  const caret = active ? saveCaret() : null;
  const next: HTMLElement[] = [];
  for (const b of d.blocks) {
    const k = lookKey(b);
    if (active && Number(active.dataset.start) === b.start && active.dataset.bsrc === b.src && !refresh) {
      blockOf.set(active, b);
      setOffsets(active, b);
      if (keyOf.get(active) !== k) stale.add(active);
      next.push(active);
      continue;
    }
    const reuse = !refresh && pool.get(k)?.shift();
    if (reuse) {
      blockOf.set(reuse, b);
      setOffsets(reuse, b);
      next.push(reuse);
      continue;
    }
    const e = renderBlock(b);
    keyOf.set(e, k);
    next.push(e);
  }
  // Replace children in place (keeps scroll position).
  page.querySelector(".loading")?.remove();
  next.forEach((e, i) => { if (page.children[i] !== e) page.insertBefore(e, page.children[i] ?? null); });
  while (page.children.length > next.length) page.lastElementChild!.remove();
  if (pendingFocus !== null) {
    focusAt(pendingFocus);
    pendingFocus = null;
  } else if (caret && active && !next.includes(active)) {
    // The block being edited was redrawn: put the caret back by text position.
    const again = next.find((e) => Number(e.dataset.start) === Number(active.dataset.start));
    if (again) restoreCaret(again, caret);
  }
  void prevDoc;
}

/** Shift a reused block's offsets to the new ones. Regions keep their offset to the block start. */
function setOffsets(box: HTMLElement, b: VBlock) {
  const delta = b.start - Number(box.dataset.start);
  box.dataset.start = String(b.start);
  box.dataset.end = String(b.end);
  box.dataset.bsrc = b.src;
  if (!delta) return;
  for (const r of box.querySelectorAll<HTMLElement>("[data-start]")) {
    r.dataset.start = String(Number(r.dataset.start) + delta);
    r.dataset.end = String(Number(r.dataset.end) + delta);
  }
  for (const r of box.querySelectorAll<HTMLElement>("[data-fig]")) r.dataset.fig = String(Number(r.dataset.fig) + delta);
}

// ---------------------------------------------------------------- caret

function saveCaret(): { region: number; offset: number } | null {
  const sel = getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  const region = (r.startContainer.nodeType === 1 ? (r.startContainer as HTMLElement) : r.startContainer.parentElement)?.closest<HTMLElement>(".region");
  const box = region?.closest<HTMLElement>(".block");
  if (!region || !box) return null;
  const all = [...box.querySelectorAll(".region")];
  const pre = document.createRange();
  pre.selectNodeContents(region);
  pre.setEnd(r.startContainer, r.startOffset);
  return { region: all.indexOf(region), offset: pre.toString().length };
}

function restoreCaret(box: HTMLElement, c: { region: number; offset: number }) {
  const region = box.querySelectorAll<HTMLElement>(".region")[c.region];
  if (!region) return;
  region.focus();
  let left = c.offset;
  const walk = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
  for (let t = walk.nextNode(); t; t = walk.nextNode()) {
    const len = t.nodeValue!.length;
    if (left <= len) { getSelection()!.collapse(t, left); return; }
    left -= len;
  }
  getSelection()!.selectAllChildren(region);
  getSelection()!.collapseToEnd();
}

/** Put the caret at a source offset: in the region that holds it, at the text node that covers it. */
function focusAt(offset: number) {
  for (const box of page.querySelectorAll<HTMLElement>(":scope > .block")) {
    const s = Number(box.dataset.start), e = Number(box.dataset.end);
    if (offset < s || offset > e) continue;
    const region = [...box.querySelectorAll<HTMLElement>(".region")].find((r) => offset >= Number(r.dataset.start) && offset <= Number(r.dataset.end)) ?? box.querySelector<HTMLElement>(".region");
    if (!region) return;
    region.focus();
    const rel = offset - s;
    const walk = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
    let last: Node | null = null;
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      const at = textAt.get(t);
      last = t;
      if (at === undefined) continue;
      if (rel >= at && rel <= at + t.nodeValue!.length) { getSelection()!.collapse(t, rel - at); return; }
      if (rel < at) { getSelection()!.collapse(t, 0); return; }
    }
    if (last) getSelection()!.collapse(last, last.nodeValue!.length);
    return;
  }
}

/** Source offset of the caret, when it is in a rendered text node. */
function caretOffset(): number | null {
  const sel = getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  const box = (r.startContainer.nodeType === 1 ? (r.startContainer as HTMLElement) : r.startContainer.parentElement)?.closest<HTMLElement>(".block");
  if (!box) return null;
  const at = textAt.get(r.startContainer);
  if (at !== undefined) return Number(box.dataset.start) + at + r.startOffset;
  const region = (r.startContainer as HTMLElement).closest?.(".region") as HTMLElement | null;
  return region ? Number(region.dataset.start) : Number(box.dataset.start);
}

// ---------------------------------------------------------------- serializing and edits

const MARK = " ";

function serialize(node: Node, keepMark = false): string {
  let out = "";
  node.childNodes.forEach((c) => {
    if (c.nodeType === 3) {
      const v = c.nodeValue ?? "";
      out += keepMark ? v.split(MARK).map((x) => escapeText(x)).join(MARK) : escapeText(v);
      return;
    }
    if (c.nodeType !== 1) return;
    const e = c as HTMLElement;
    if (e.classList.contains("del")) return;
    if (e.dataset.src !== undefined && e.classList.contains("atom")) { out += e.dataset.src; return; }
    const tag = e.tagName;
    const inner = serialize(e, keepMark);
    if (tag === "BR") return;
    let cmd = e.dataset.cmd;
    if (!cmd) cmd = tag === "B" || tag === "STRONG" ? "textbf" : tag === "I" || tag === "EM" ? "textit" : tag === "U" ? "underline" : "";
    if (cmd) out += inner ? `\\${cmd}{${inner}}` : "";
    else if (tag === "DIV" || tag === "P") out += (out ? "\n\n" : "") + inner;
    else out += inner;
  });
  return out;
}

function regionText(r: HTMLElement): string {
  return r.dataset.region === "code" ? (r.textContent ?? "") : serialize(r);
}

const timers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

function flush(r: HTMLElement): string | null {
  clearTimeout(timers.get(r));
  if (r.dataset.field) {
    const value = serialize(r).trim();
    if (value) vscode.postMessage({ type: "field", fig: Number(r.dataset.fig), which: r.dataset.field, value });
    return null;
  }
  const text = regionText(r);
  const old = r.dataset.src ?? "";
  if (text === old) return text;
  let start = Number(r.dataset.start), end = Number(r.dataset.end);
  let delta = text.length - old.length;
  if (r.dataset.pending) {
    // The first text of a new paragraph: a blank line, then the text, after the previous one.
    if (!text.trim()) return null;
    vscode.postMessage({ type: "edit", start, end, old: "", text: "\n\n" + text });
    delete r.dataset.pending;
    start += 2;
    end += 2;
    delta += 2;
    r.dataset.start = String(start);
    const nb = r.closest<HTMLElement>(".block")!;
    nb.dataset.start = String(start);
    nb.dataset.end = String(start);
    nb.dataset.bsrc = "";
    // Everything after it moves too.
    for (const o of page.querySelectorAll<HTMLElement>("[data-start]")) {
      if (o === r || o === nb) continue;
      if (Number(o.dataset.start) >= start - 2) { o.dataset.start = String(Number(o.dataset.start) + delta); o.dataset.end = String(Number(o.dataset.end) + delta); }
    }
    for (const o of page.querySelectorAll<HTMLElement>("[data-fig]")) if (Number(o.dataset.fig) >= start - 2) o.dataset.fig = String(Number(o.dataset.fig) + delta);
    r.dataset.src = text;
    r.dataset.end = String(start + text.length);
    nb.dataset.bsrc = text;
    nb.dataset.end = r.dataset.end;
    return text;
  }
  vscode.postMessage({ type: "edit", start, end, old, text });
  r.dataset.src = text;
  r.dataset.end = String(start + text.length);
  const box = r.closest<HTMLElement>(".block")!;
  const bs = Number(box.dataset.start);
  box.dataset.bsrc = (box.dataset.bsrc ?? "").slice(0, start - bs) + text + (box.dataset.bsrc ?? "").slice(end - bs);
  box.dataset.end = String(Number(box.dataset.end) + delta);
  // Everything after the edit moves.
  for (const o of page.querySelectorAll<HTMLElement>("[data-start]")) {
    if (o === r || o === box) continue;
    const s = Number(o.dataset.start);
    if (s >= end) { o.dataset.start = String(s + delta); o.dataset.end = String(Number(o.dataset.end) + delta); }
    else if (o.contains(r) && Number(o.dataset.end) >= end && o !== box) o.dataset.end = String(Number(o.dataset.end) + delta);
  }
  for (const o of page.querySelectorAll<HTMLElement>("[data-fig]")) if (Number(o.dataset.fig) >= end) o.dataset.fig = String(Number(o.dataset.fig) + delta);
  return text;
}

page.addEventListener("input", (ev) => {
  const t = ev.target as HTMLElement;
  if (t.tagName === "INPUT" && t.dataset.fig) {
    clearTimeout(timers.get(t));
    timers.set(t, setTimeout(() => vscode.postMessage({ type: "field", fig: Number(t.dataset.fig), which: "label", value: (t as HTMLInputElement).value }), 400));
    return;
  }
  if (t.tagName === "TEXTAREA" && t.dataset.math !== undefined) {
    const box = t.closest<HTMLElement>(".block")!;
    const prev = box.querySelector<HTMLElement>(".eqprev");
    const ta = t as HTMLTextAreaElement;
    if (prev) renderMath(mathTex(ta.value), prev, true);
    clearTimeout(timers.get(t));
    timers.set(t, setTimeout(() => flushMath(ta), 400));
    return;
  }
  const r = t.closest<HTMLElement>(".region");
  if (!r || (ev as InputEvent).isComposing) return;
  r.classList.remove("empty");
  clearTimeout(timers.get(r));
  timers.set(r, setTimeout(() => flush(r), 300));
});

page.addEventListener("compositionend", (ev) => {
  const r = (ev.target as HTMLElement).closest<HTMLElement>(".region");
  if (r) { clearTimeout(timers.get(r)); timers.set(r, setTimeout(() => flush(r), 300)); }
});

page.addEventListener("keydown", (ev) => {
  const t = ev.target as HTMLElement;
  const r = t.closest<HTMLElement>(".region");
  if (t.tagName === "INPUT" && ev.key === "Enter") { t.blur(); return; }
  if (!r || r.dataset.region === "code") return;
  const box = r.closest<HTMLElement>(".block")!;
  if (ev.key === "Enter" && !ev.shiftKey) {
    ev.preventDefault();
    if (!box.classList.contains("para")) { r.blur(); return; }
    if (caretAtEnd(r)) {
      // Nothing after the caret: an empty paragraph that reaches the source once something is typed.
      flush(r);
      const nb = el("div", "block para");
      const np = el("p");
      editable(np, Number(r.dataset.end), Number(r.dataset.end), "", "inline");
      np.dataset.pending = "1";
      nb.dataset.start = np.dataset.start;
      nb.dataset.end = np.dataset.end;
      nb.dataset.bsrc = "";
      nb.appendChild(np);
      box.after(nb);
      np.focus();
      return;
    }
    // A new paragraph: a blank line in the source at the caret.
    document.execCommand("insertText", false, MARK);
    const withMark = serialize(r, true);
    const at = withMark.indexOf(MARK);
    clearTimeout(timers.get(r));
    const text = withMark.replace(MARK, "\n\n");
    const old = r.dataset.src ?? "";
    const start = Number(r.dataset.start);
    vscode.postMessage({ type: "edit", start, end: Number(r.dataset.end), old, text });
    r.dataset.src = text;
    box.dataset.bsrc = text;
    pendingFocus = start + at + 2;
    return;
  }
  if ((ev.key === "Backspace" || ev.key === "Delete") && box.classList.contains("para")) {
    const sel = getSelection()!;
    if (!sel.isCollapsed) return;
    const pre = document.createRange();
    pre.selectNodeContents(r);
    pre.setEnd(sel.anchorNode!, sel.anchorOffset);
    const before = pre.toString().length;
    const len = (r.textContent ?? "").length;
    if (ev.key === "Backspace" && before === 0) {
      const prev = box.previousElementSibling as HTMLElement | null;
      if (prev?.classList.contains("para")) { ev.preventDefault(); join(prev, box); }
    } else if (ev.key === "Delete" && before === len) {
      const next = box.nextElementSibling as HTMLElement | null;
      if (next?.classList.contains("para")) { ev.preventDefault(); join(box, next); }
    }
  }
  if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && !ev.shiftKey && ["b", "i", "u"].includes(ev.key.toLowerCase())) {
    // The browser's own bold would run as well as VS Code's keybinding, which sends "format" back.
    ev.preventDefault();
  }
});

/** Bold, italic or underline for the selection; serialize writes \\textbf, \\textit or \\underline. */
function format(cmd: string) {
  if (!["bold", "italic", "underline"].includes(cmd)) return;
  const sel = getSelection();
  const at = sel?.rangeCount ? sel.getRangeAt(0).startContainer : null;
  const r = (at?.nodeType === 1 ? (at as HTMLElement) : at?.parentElement)?.closest<HTMLElement>(".region");
  if (!r || r.dataset.region === "code") return;
  document.execCommand("styleWithCSS", false, "false");
  document.execCommand(cmd);
  clearTimeout(timers.get(r));
  timers.set(r, setTimeout(() => flush(r), 300));
}

function caretAtEnd(r: HTMLElement): boolean {
  const sel = getSelection();
  if (!sel || !sel.rangeCount) return false;
  const after = document.createRange();
  after.selectNodeContents(r);
  after.setStart(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
  const frag = after.cloneContents();
  return !(frag.textContent ?? "").trim() && !frag.querySelector?.(".atom");
}

/** Join two paragraphs: the blank lines between them become one space. */
function join(a: HTMLElement, b: HTMLElement) {
  const ra = a.querySelector<HTMLElement>(".region")!, rb = b.querySelector<HTMLElement>(".region")!;
  flush(ra);
  flush(rb);
  const aEnd = Number(ra.dataset.end), bStart = Number(rb.dataset.start);
  vscode.postMessage({ type: "join", start: aEnd, end: bStart });
  pendingFocus = aEnd + 1;
}

page.addEventListener("paste", (ev) => {
  const r = (ev.target as HTMLElement).closest<HTMLElement>(".region");
  if (!r) return;
  ev.preventDefault();
  const text = ev.clipboardData?.getData("text/plain") ?? "";
  document.execCommand("insertText", false, r.dataset.region === "code" ? text : text.replace(/\r?\n\s*\n/g, MARK).replace(/\r?\n/g, " "));
});

page.addEventListener("focusout", (ev) => {
  const r = (ev.target as HTMLElement).closest?.<HTMLElement>(".region");
  if (r) flush(r);
  const box = (ev.target as HTMLElement).closest?.<HTMLElement>(".block");
  setTimeout(() => {
    if (!box || box.contains(document.activeElement) || !stale.has(box)) return;
    stale.delete(box);
    const b = blockOf.get(box);
    if (!b || !box.isConnected) return;
    const fresh = renderBlock(b);
    keyOf.set(fresh, lookKey(b));
    box.replaceWith(fresh);
  }, 0);
});

// ---------------------------------------------------------------- math blocks

function mathTex(src: string): string {
  const s = src.trim();
  if (s.startsWith("\\[")) return s.replace(/^\\\[/, "").replace(/\\\]$/, "");
  if (s.startsWith("$$")) return s.replace(/^\$\$/, "").replace(/\$\$$/, "");
  return s.replace(/\\label\{[^}]*\}/g, "").replace(/\\nonumber|\\notag/g, "");
}

function flushMath(t: HTMLTextAreaElement) {
  clearTimeout(timers.get(t));
  const old = t.dataset.src ?? "";
  if (t.value === old) return;
  const start = Number(t.dataset.start);
  vscode.postMessage({ type: "edit", start, end: Number(t.dataset.end), old, text: t.value });
  t.dataset.src = t.value;
  t.dataset.end = String(start + t.value.length);
  const box = t.closest<HTMLElement>(".block")!;
  box.dataset.bsrc = t.value;
}

function openMath(box: HTMLElement) {
  const b = blockOf.get(box);
  if (!b || box.querySelector("textarea")) return;
  const prev = el("div", "eqprev");
  renderMath(mathTex(b.src), prev, true);
  const t = el("textarea", "eqsrc");
  t.value = b.src;
  t.dataset.math = "";
  t.dataset.start = String(b.start);
  t.dataset.end = String(b.end);
  t.dataset.src = b.src;
  t.spellcheck = false;
  t.rows = Math.min(12, b.src.split("\n").length + 1);
  box.textContent = "";
  box.append(prev, t);
  t.focus();
  t.addEventListener("blur", () => {
    flushMath(t);
    setTimeout(() => {
      const nb = blockOf.get(box);
      if (!nb || !box.isConnected) return;
      const fresh = renderBlock({ ...nb, src: t.value, tex: mathTex(t.value) });
      keyOf.set(fresh, "");
      box.replaceWith(fresh);
    }, 0);
  });
  t.addEventListener("keydown", (e) => { if (e.key === "Escape") t.blur(); });
}

// ---------------------------------------------------------------- atoms and changes

let pop: HTMLElement | null = null;
function closePop() { pop?.remove(); pop = null; }

function editAtom(a: HTMLElement) {
  closePop();
  const r = a.closest<HTMLElement>(".region");
  if (!r) return;
  pop = el("div", "pop");
  const t = el("textarea");
  t.value = a.dataset.src ?? "";
  t.spellcheck = false;
  t.rows = Math.min(6, t.value.split("\n").length);
  const prev = el("div", "popprev");
  const preview = () => { if (a.dataset.kind === "math") renderMath(t.value.replace(/^\$\$?|\$\$?$/g, "").replace(/^\\\(|\\\)$/g, ""), prev, false); };
  preview();
  pop.append(t, prev, el("div", "hint", "Enter to apply, Esc to cancel"));
  document.body.appendChild(pop);
  const rect = a.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(rect.left + scrollX, innerWidth - 340))}px`;
  pop.style.top = `${rect.bottom + scrollY + 4}px`;
  t.focus();
  t.select();
  const apply = () => {
    const v = t.value;
    closePop();
    if (v === a.dataset.src) return;
    a.dataset.src = v;
    if (!v) a.remove();
    else {
      a.textContent = v;
      a.classList.add("raw");
    }
    flush(r);
    stale.add(r.closest<HTMLElement>(".block")!);
  };
  t.addEventListener("input", preview);
  t.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); apply(); }
    if (e.key === "Escape") { e.preventDefault(); closePop(); }
  });
  t.addEventListener("blur", () => setTimeout(() => { if (pop && !pop.contains(document.activeElement)) apply(); }, 0));
}

function showDecide(target: HTMLElement) {
  closePop();
  const c = Number(target.dataset.c);
  const ch = doc?.changes[c];
  if (!ch) return;
  pop = el("div", "pop decide");
  const ok = el("button", "ok", "✓ Accept");
  const no = el("button", "no", "✗ Reject");
  ok.onclick = () => { closePop(); vscode.postMessage({ type: "decide", accept: true, curStart: ch.curStart, curEnd: ch.curEnd }); };
  no.onclick = () => { closePop(); vscode.postMessage({ type: "decide", accept: false, curStart: ch.curStart, curEnd: ch.curEnd }); };
  pop.append(ok, no);
  document.body.appendChild(pop);
  const rect = target.getBoundingClientRect();
  pop.style.left = `${Math.max(8, rect.left + scrollX)}px`;
  pop.style.top = `${rect.top + scrollY - 34}px`;
}

page.addEventListener("click", (ev) => {
  const t = ev.target as HTMLElement;
  const atom = t.closest<HTMLElement>(".atom");
  if (atom && atom.closest(".region")) { ev.preventDefault(); editAtom(atom); return; }
  const mark = t.closest<HTMLElement>(".ins, .del");
  if (mark && mark.dataset.c !== undefined) { showDecide(mark); return; }
  const eq = t.closest<HTMLElement>(".block.math");
  if (eq) { openMath(eq); return; }
  if (pop && !pop.contains(t)) closePop();
});

// Double-click on text: show that word in the source.
page.addEventListener("dblclick", (ev) => {
  if ((ev.target as HTMLElement).closest(".pic")) return;
  setTimeout(() => {
    const sel = getSelection();
    const o = caretOffset();
    if (o === null) return;
    vscode.postMessage({ type: "jump", offset: o, length: sel && !sel.isCollapsed ? sel.toString().length : 0 });
  }, 0);
});

document.addEventListener("mousedown", (ev) => {
  if (pop && !pop.contains(ev.target as Node) && !(ev.target as HTMLElement).closest(".ins, .del, .atom")) closePop();
});

// Tell the source where we are.
let revealTimer: ReturnType<typeof setTimeout> | undefined;
document.addEventListener("selectionchange", () => {
  if (!page.contains(document.activeElement)) return;
  clearTimeout(revealTimer);
  revealTimer = setTimeout(() => {
    const o = caretOffset();
    if (o !== null) vscode.postMessage({ type: "reveal", offset: o });
  }, 250);
});

// ---------------------------------------------------------------- messages

window.addEventListener("message", (e) => {
  const m = e.data;
  if (m.type === "pictures") for (const [k, v] of Object.entries(m.items as Record<string, string>)) pictureData.set(k, v);
  if (m.type === "doc") render(m.doc, !!m.refresh);
  if (m.type === "format") format(m.cmd);
  if (m.type === "cursor") {
    if (document.hasFocus() && page.contains(document.activeElement)) return;
    for (const box of page.querySelectorAll<HTMLElement>(":scope > .block")) {
      if (m.offset >= Number(box.dataset.start) && m.offset <= Number(box.dataset.end) + 1) {
        const r = box.getBoundingClientRect();
        if (r.top < 40 || r.bottom > innerHeight) box.scrollIntoView({ block: "center" });
        box.classList.add("here");
        setTimeout(() => box.classList.remove("here"), 900);
        break;
      }
    }
  }
});
window.addEventListener("error", (e) => vscode.postMessage({ type: "log", text: `error: ${e.message} @${e.lineno}` }));
window.addEventListener("unhandledrejection", (e) => vscode.postMessage({ type: "log", text: `rejection: ${(e.reason as Error)?.message ?? e.reason}` }));
vscode.postMessage({ type: "ready" });
