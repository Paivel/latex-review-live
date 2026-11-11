// Macros a document defines in its preamble, as KaTeX macros, so formulas using them draw.
import { groupEnd } from "./inline";

/**
 * \newcommand, \renewcommand, \providecommand (with or without *, braces
 * around the name or not, a number of arguments), \DeclareMathOperator(*)
 * and a plain \def without parameters. A command with an optional
 * argument's default is left out: KaTeX cannot take it.
 */
export function preambleMacros(pre: string): Record<string, string> {
  const s = pre.replace(/(^|[^\\])%.*$/gm, "$1");
  const out: Record<string, string> = {};
  const re = /\\(newcommand|renewcommand|providecommand|DeclareMathOperator|def)\b\*?\s*/g;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    let k = m.index + m[0].length;
    // The name: {\foo} or \foo.
    let name: string | null = null;
    if (s[k] === "{") {
      const e = groupEnd(s, k);
      if (e < 0) continue;
      name = s.slice(k + 1, e - 1).trim();
      k = e;
    } else {
      const n = /^\\([a-zA-Z@]+|.)/.exec(s.slice(k));
      if (!n) continue;
      name = n[0];
      k += n[0].length;
    }
    if (!/^\\([a-zA-Z@]+|.)$/.test(name)) continue;
    while (s[k] === " ") k++;
    let optionalDefault = false;
    if (m[1] !== "def" && m[1] !== "DeclareMathOperator") {
      const args = /^\[\s*(\d)\s*\]\s*/.exec(s.slice(k));
      if (args) k += args[0].length;
      if (s[k] === "[") optionalDefault = true;
    }
    if (m[1] === "def" && s[k] !== "{") continue; // \def\x#1{..}: parameters are not read.
    if (s[k] !== "{") continue;
    const e = groupEnd(s, k);
    if (e < 0) continue;
    re.lastIndex = e;
    if (optionalDefault) continue;
    const body = s.slice(k + 1, e - 1);
    if (m[1] === "providecommand" && name in out) continue;
    out[name] = m[1] === "DeclareMathOperator" ? (m[0].includes("*") ? `\\operatorname*{${body}}` : `\\operatorname{${body}}`) : body;
  }
  return out;
}
