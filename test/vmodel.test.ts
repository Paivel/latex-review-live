import { describe, expect, it } from "vitest";
import { buildDoc } from "../src/visual/model";

const text = String.raw`\documentclass{article}
\begin{document}
Hello brave world \textbf{bold} 50\% end.
\end{document}
`;
const at = (s: string) => text.indexOf(s);

describe("visual model", () => {
  it("marks insertions and deletions", () => {
    const d = buildDoc({
      text, uri: "u", version: 1, name: "main.tex", look: {}, tracking: true, images: () => [],
      marks: [
        { curStart: at("brave"), curEnd: at("brave") + 6, deleted: "" },
        { curStart: at("bold"), curEnd: at("bold"), deleted: "very " },
        { curStart: at(" end"), curEnd: at(" end"), deleted: " gone" },
      ],
    });
    const p = d.blocks.find((b) => b.kind === "para")!;
    const flat = (ns: any[]): string => ns.map((n) => n.t === "text" ? (n.ins !== undefined ? `[+${n.s}]` : n.s) : n.t === "del" ? `[-${n.s}]` : n.t === "fmt" ? `<${flat(n.kids)}>` : n.src).join("");
    expect(flat(p.nodes!)).toBe("Hello [+brave ]world <[-very ]bold> 50%[- gone] end.");
  });
});

describe("deleted paragraphs", () => {
  it("get a block of their own between the paragraphs", () => {
    const t = "\\begin{document}\nfirst\n\n\n\nsecond\n\\end{document}\n";
    const gap = t.indexOf("\n\n\n") + 2;
    const d = buildDoc({ text: t, uri: "u", version: 1, name: "m", look: {}, tracking: true, images: () => [], marks: [{ curStart: gap, curEnd: gap, deleted: "asa" }] });
    expect(d.blocks.map((b) => b.kind)).toEqual(["preamble", "para", "deleted", "para", "tail"]);
    expect(d.blocks[2].nodes).toEqual([{ t: "del", s: "asa", c: 0 }]);
  });
  it("are not drawn twice when a paragraph shows them", () => {
    const t = "\\begin{document}\nfirst word\n\\end{document}\n";
    const d = buildDoc({ text: t, uri: "u", version: 1, name: "m", look: {}, tracking: true, images: () => [], marks: [{ curStart: t.indexOf(" word"), curEnd: t.indexOf(" word"), deleted: " big" }] });
    expect(d.blocks.some((b) => b.kind === "deleted")).toBe(false);
  });
});
