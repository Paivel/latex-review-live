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
