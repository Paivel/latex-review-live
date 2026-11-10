/** Unicode stand-ins for LaTeX, used by live preview. */

export const MATH_SYMBOLS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ",
  iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", varpi: "ϖ", rho: "ρ", varrho: "ϱ", sigma: "σ",
  varsigma: "ς", tau: "τ", upsilon: "υ", phi: "ϕ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  to: "→", rightarrow: "→", leftarrow: "←", gets: "←", leftrightarrow: "↔", Rightarrow: "⇒", Leftarrow: "⇐", Leftrightarrow: "⇔",
  longrightarrow: "⟶", longleftarrow: "⟵", mapsto: "↦", uparrow: "↑", downarrow: "↓", rightleftharpoons: "⇌", leftrightharpoons: "⇋",
  implies: "⟹", iff: "⟺",
  leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠", approx: "≈", sim: "∼", simeq: "≃", cong: "≅", equiv: "≡", propto: "∝",
  ll: "≪", gg: "≫", pm: "±", mp: "∓", times: "×", cdot: "·", div: "÷", ast: "∗", star: "⋆", circ: "∘", bullet: "•",
  infty: "∞", partial: "∂", nabla: "∇", sum: "∑", prod: "∏", int: "∫", oint: "∮", iint: "∬", sqrt: "√",
  in: "∈", notin: "∉", ni: "∋", subset: "⊂", subseteq: "⊆", supset: "⊃", supseteq: "⊇", cup: "∪", cap: "∩", emptyset: "∅", varnothing: "∅",
  forall: "∀", exists: "∃", neg: "¬", lnot: "¬", land: "∧", wedge: "∧", lor: "∨", vee: "∨", oplus: "⊕", otimes: "⊗",
  ldots: "…", cdots: "⋯", vdots: "⋮", ddots: "⋱", dots: "…", prime: "′", degree: "°", angle: "∠", perp: "⊥", parallel: "∥",
  hbar: "ℏ", ell: "ℓ", Re: "ℜ", Im: "ℑ", aleph: "ℵ", langle: "⟨", rangle: "⟩", lceil: "⌈", rceil: "⌉", lfloor: "⌊", rfloor: "⌋",
  quad: "  ", qquad: "    ", ",": " ", ";": " ", ":": " ", "!": "", " ": " ", "{": "{", "}": "}", "|": "‖", lvert: "|", rvert: "|", vert: "|", mid: "|",
  AA: "Å", ohm: "Ω",
};

export const TEXT_SYMBOLS: Record<string, string> = {
  ldots: "…", dots: "…", textellipsis: "…", LaTeX: "LaTeX", TeX: "TeX", textdegree: "°", degree: "°", textpm: "±", pm: "±",
  times: "×", texttimes: "×", textendash: "–", textemdash: "—", textbackslash: "\\", textasciitilde: "~", textbullet: "•",
  copyright: "©", textcopyright: "©", textregistered: "®", texttrademark: "™", S: "§", P: "¶", dag: "†", ddag: "‡",
  ss: "ß", ae: "æ", AE: "Æ", oe: "œ", OE: "Œ", o: "ø", O: "Ø", aa: "å", AA: "Å", l: "ł", L: "Ł", i: "ı",
  "%": "%", "&": "&", "#": "#", _: "_", $: "$", "{": "{", "}": "}", ",": " ", ";": " ", ":": " ", " ": " ", "@": "",
  quad: "  ", qquad: "    ", enspace: " ", thinspace: " ", textmu: "µ", micro: "µ", textperthousand: "‰", textcelsius: "℃",
  euro: "€", textsterling: "£", textquotedblleft: "“", textquotedblright: "”", textquoteleft: "‘", textquoteright: "’",
  guillemotleft: "«", guillemotright: "»", textless: "<", textgreater: ">", textbar: "|", checkmark: "✓",
};

const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ", a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ",
  h: "ʰ", j: "ʲ", k: "ᵏ", l: "ˡ", m: "ᵐ", o: "ᵒ", p: "ᵖ", r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ", x: "ˣ", y: "ʸ", z: "ᶻ",
  T: "ᵀ", "•": "•", "·": "˙", "*": "*", "′": "′",
};
const SUB: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ",
  o: "ₒ", p: "ₚ", r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ",
};

/** The string in Unicode superscript, or undefined if some character has none. */
export function toSup(s: string): string | undefined {
  let out = "";
  for (const ch of s) {
    const m = SUP[ch];
    if (m === undefined) return undefined;
    out += m;
  }
  return out;
}

export function toSub(s: string): string | undefined {
  let out = "";
  for (const ch of s) {
    const m = SUB[ch];
    if (m === undefined) return undefined;
    out += m;
  }
  return out;
}

/** siunitx unit macros. */
export const UNITS: Record<string, string> = {
  gram: "g", metre: "m", meter: "m", second: "s", litre: "L", liter: "L", mole: "mol", kelvin: "K", celsius: "°C", degreeCelsius: "°C",
  ampere: "A", volt: "V", watt: "W", joule: "J", calorie: "cal", hertz: "Hz", pascal: "Pa", bar: "bar", newton: "N", coulomb: "C",
  ohm: "Ω", molar: "M", Molar: "M", hour: "h", minute: "min", day: "d", percent: "%", degree: "°", angstrom: "Å", dalton: "Da",
  electronvolt: "eV", tesla: "T", atmosphere: "atm", atm: "atm", torr: "Torr", ppm: "ppm", equivalent: "equiv",
  kilo: "k", mega: "M", giga: "G", milli: "m", micro: "µ", nano: "n", pico: "p", femto: "f", centi: "c", deci: "d",
  g: "g", m: "m", s: "s", L: "L", mol: "mol", K: "K", h: "h", mg: "mg", kg: "kg", mL: "mL", ml: "mL", uL: "µL", mmol: "mmol",
  umol: "µmol", mM: "mM", uM: "µM", nM: "nM", nm: "nm", um: "µm", mm: "mm", cm: "cm", km: "km", ms: "ms", us: "µs", ns: "ns",
  kJ: "kJ", kcal: "kcal", MHz: "MHz", GHz: "GHz", kHz: "kHz", eV: "eV", Da: "Da", kDa: "kDa", min: "min",
};
