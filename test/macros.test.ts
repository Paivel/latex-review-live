import { describe, expect, it } from "vitest";
import { preambleMacros } from "../src/visual/macros";

describe("preambleMacros", () => {
  it("reads the usual forms", () => {
    const m = preambleMacros(String.raw`\newcommand{\R}{\mathbb{R}}
\newcommand\kB{k_\mathrm{B}}
\renewcommand*{\vec}[1]{\mathbf{#1}}
\providecommand{\dd}{\mathrm{d}}
\DeclareMathOperator{\Tr}{Tr}
\DeclareMathOperator*{\argmax}{arg\,max}
\def\eps{\varepsilon}
% \newcommand{\off}{no}
\newcommand{\opt}[2][x]{#1#2}
\newcommand{\ce}{x}`);
    expect(m["\\R"]).toBe("\\mathbb{R}");
    expect(m["\\kB"]).toBe("k_\\mathrm{B}");
    expect(m["\\vec"]).toBe("\\mathbf{#1}");
    expect(m["\\dd"]).toBe("\\mathrm{d}");
    expect(m["\\Tr"]).toBe("\\operatorname{Tr}");
    expect(m["\\argmax"]).toBe("\\operatorname*{arg\\,max}");
    expect(m["\\eps"]).toBe("\\varepsilon");
    expect(m["\\off"]).toBeUndefined();
    expect(m["\\opt"]).toBeUndefined();
  });
});
