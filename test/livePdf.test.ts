import { describe, it, expect } from "vitest";
import { engineFlag, logErrors, missingChanges, parseSynctexEdit } from "../src/visual/livePdf";

describe("live PDF helpers", () => {
  it("picks the engine from a magic comment", () => {
    expect(engineFlag("\\documentclass{article}")).toBe("-pdf");
    expect(engineFlag("% !TEX program = xelatex\n\\documentclass{article}")).toBe("-xelatex");
    expect(engineFlag("%!TEX TS-program = lualatex\n")).toBe("-lualatex");
  });
  it("reads file:line errors", () => {
    const log = "(./main.tex\n/Users/p/x/.latex-review/live/main.tex:72: LaTeX Error: Unicode character ы\nmore\n";
    expect(logErrors(log)).toEqual(["line 72: LaTeX Error: Unicode character ы"]);
    expect(logErrors("! Undefined control sequence.\n")).toEqual(["Undefined control sequence."]);
  });
  it("reads synctex edit output", () => {
    const out = "This is SyncTeX command line utility, version 1.5\nSyncTeX result begin\nOutput:/a/main.pdf\nInput:/a/./main.tex\nLine:42\nColumn:-1\nOffset:0\nContext:\nSyncTeX result end\n";
    expect(parseSynctexEdit(out)).toEqual({ input: "/a/./main.tex", line: 42 });
    expect(parseSynctexEdit("SyncTeX result begin\nSyncTeX result end\n")).toBeNull();
  });
  it("sees a missing changes package in the log", () => {
    expect(missingChanges("! LaTeX Error: File `changes.sty' not found.\n")).toBe(true);
    expect(missingChanges("! LaTeX Error: File `achemso.sty' not found.\n")).toBe(false);
  });
});
