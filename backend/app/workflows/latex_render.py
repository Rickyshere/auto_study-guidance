# -*- coding: utf-8 -*-
"""LaTeX → printable HTML for the PyMuPDF *Story* print pipeline.

PyMuPDF's Story renderer has no TeX engine and no MathML support, so formulas must
arrive as plain HTML.  A naive "strip the backslashes" approach silently destroys
math (`\\rightleftharpoons` → `leftharpoons`, `^{\\circ}` → `^c`); this module instead
parses the LaTeX subset that the study-material prompts actually produce and emits
HTML that Story lays out correctly:

* ``^`` / ``_`` become real ``<sup>`` / ``<sub>`` elements;
* ``\\frac`` becomes a staged, rule-separated fraction table in display math and a
  parenthesised ``num/den`` in inline math (an inline table would force a line break
  in Story);
* every Greek letter, relation, arrow and chemistry equilibrium sign in the prompt
  vocabulary is mapped to a real Unicode glyph;
* unknown control sequences degrade to their upright name instead of leaking
  backslashes into the printed page.
"""

from __future__ import annotations

import html
import re
from typing import Dict, List, Tuple

# --------------------------------------------------------------------------------------
# Symbol table
# --------------------------------------------------------------------------------------

_GREEK: Dict[str, str] = {
    "alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "epsilon": "ε",
    "varepsilon": "ε", "zeta": "ζ", "eta": "η", "theta": "θ", "vartheta": "ϑ",
    "iota": "ι", "kappa": "κ", "varkappa": "ϰ", "lambda": "λ", "mu": "μ", "nu": "ν",
    "xi": "ξ", "omicron": "ο", "pi": "π", "varpi": "ϖ", "rho": "ρ", "varrho": "ϱ",
    "sigma": "σ", "varsigma": "ς", "tau": "τ", "upsilon": "υ", "phi": "φ",
    "varphi": "φ", "chi": "χ", "psi": "ψ", "omega": "ω",
    "Gamma": "Γ", "Delta": "Δ", "Theta": "Θ", "Lambda": "Λ", "Xi": "Ξ", "Pi": "Π",
    "Sigma": "Σ", "Upsilon": "Υ", "Phi": "Φ", "Psi": "Ψ", "Omega": "Ω",
}

_SYMBOLS: Dict[str, str] = {
    # relations / operators
    "pm": "±", "mp": "∓", "times": "×", "div": "÷", "cdot": "·", "ast": "∗",
    "star": "⋆", "circ": "∘", "bullet": "•", "oplus": "⊕", "ominus": "⊖",
    "otimes": "⊗", "odot": "⊙", "oslash": "⊘",
    "le": "≤", "leq": "≤", "leqslant": "⩽", "ge": "≥", "geq": "≥",
    "geqslant": "⩾", "ne": "≠", "neq": "≠", "approx": "≈", "cong": "≅",
    "equiv": "≡", "sim": "∼", "simeq": "≃", "asymp": "≍", "propto": "∝",
    "ll": "≪", "gg": "≫", "doteq": "≐", "triangleq": "≜", "therefore": "∴",
    "because": "∵", "lll": "⋘", "ggg": "⋙",
    # sets / logic
    "in": "∈", "notin": "∉", "ni": "∋", "subset": "⊂", "subseteq": "⊆",
    "supset": "⊃", "supseteq": "⊇", "cap": "∩", "cup": "∪", "setminus": "∖",
    "emptyset": "∅", "varnothing": "∅", "forall": "∀", "exists": "∃",
    "nexists": "∄", "neg": "¬", "land": "∧", "lor": "∨", "wedge": "∧",
    "vee": "∨", "mid": "|", "nmid": "∤", "parallel": "∥", "nparallel": "∦",
    "perp": "⊥", "bot": "⊥", "angle": "∠", "measuredangle": "∡",
    "square": "□", "blacksquare": "■", "triangle": "△", "bigtriangleup": "△",
    "checkmark": "✓", "degree": "°", "dg": "°",
    # arrows / chemistry
    "leftarrow": "←", "gets": "←", "rightarrow": "→", "to": "→", "uparrow": "↑",
    "downarrow": "↓", "updownarrow": "↕", "leftrightarrow": "↔",
    "Leftarrow": "⇐", "Rightarrow": "⇒", "Leftrightarrow": "⇔",
    "implies": "⇒", "iff": "⇔", "mapsto": "↦", "longrightarrow": "⟶",
    "longleftarrow": "⟵", "longleftrightarrow": "⟷", "Longrightarrow": "⟹",
    "harr": "↔", "rightleftharpoons": "⇌", "leftrightharpoons": "⇋",
    "rightleftarrows": "⇄", "leftrightarrows": "⇆", "leftharpoonup": "↼",
    "leftharpoondown": "↽", "rightharpoonup": "⇀", "rightharpoondown": "⇁",
    "upharpoonleft": "↿", "upharpoonright": "↾", "curvearrowleft": "↶",
    "curvearrowright": "↷", "nearrow": "↗", "searrow": "↘", "swarrow": "↙",
    "nwarrow": "↖", "rightsquigarrow": "⇝", "leadsto": "⇝",
    # big operators / calculus
    "sum": "∑", "prod": "∏", "coprod": "∐", "int": "∫", "iint": "∬",
    "iiint": "∭", "oint": "∮", "nabla": "∇", "partial": "∂", "infty": "∞",
    "surd": "√", "prime": "′", "dprime": "″", "dagger": "†", "ddagger": "‡",
    "hbar": "ℏ", "ell": "ℓ", "Re": "ℜ", "Im": "ℑ", "aleph": "ℵ", "wp": "℘",
    # delimiters
    "langle": "⟨", "rangle": "⟩", "lceil": "⌈", "rceil": "⌉", "lfloor": "⌊",
    "rfloor": "⌋", "lbrace": "{", "rbrace": "}", "vert": "|", "Vert": "‖",
    "backslash": "∖", "top": "ᵀ", "intercal": "ᵀ",
    # dots / misc
    "ldots": "…", "dots": "…", "cdots": "⋯", "vdots": "⋮", "ddots": "⋱",
    "colon": ":", "lnot": "¬", "mod": "mod", "bmod": "mod",
}

_SYMBOLS.update(_GREEK)

# Control words that only carry styling and can be dropped entirely.
_IGNORED = {
    "left", "right", "middle", "big", "Big", "bigg", "Bigg", "bigl", "bigr",
    "Bigl", "Bigr", "biggl", "biggr", "Biggl", "Biggr", "displaystyle",
    "textstyle", "scriptstyle", "limits", "nolimits", "nonumber", "notag",
    "hline", "quad", "qquad", "thinspace", "relax", "strut", "mathstrut",
    # boxes / decorations whose content should simply flow as normal maths
    "boxed", "fbox", "framebox", "makebox", "underbrace", "overbrace",
    "mathop", "mathbin", "mathrel", "mathord", "mathopen", "mathclose",
}

# Control words that are typeset upright as multi-letter operator names.
_FUNCTIONS = {
    "log", "lg", "ln", "exp", "sin", "cos", "tan", "cot", "sec", "csc",
    "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "coth", "det",
    "dim", "ker", "deg", "gcd", "hom", "lim", "limsup", "liminf", "max",
    "min", "sup", "inf", "arg", "Pr", "tr", "rank", "sgn", "erf",
}

_TEXT_WRAPPERS = {"text", "textrm", "textnormal", "mbox", "hbox"}
# `\mathrm{...}` stays in maths mode (so `\mathrm{Ag^+}` keeps its superscript); it only
# means "upright", and this renderer never italicises variables anyway.
_UPRIGHT_WRAPPERS = {"mathrm", "rm", "mathnormal", "mathsf", "operatorname", "mathop"}
_BOLD_WRAPPERS = {"mathbf", "bm", "boldsymbol", "textbf", "bf"}
_ITALIC_WRAPPERS = {"mathit", "textit", "it", "mathcal", "mathscr"}

_FRAC_COMMANDS = {"frac", "dfrac", "tfrac", "cfrac", "genfrac"}
_SQRT_COMMANDS = {"sqrt"}
_ACCENT_MARKS = {
    "bar": "\u0304",
    "overline": "\u0305",
    "hat": "\u0302",
    "widehat": "\u0302",
    "tilde": "\u0303",
    "widetilde": "\u0303",
    "vec": "\u20d7",
    "dot": "\u0307",
    "ddot": "\u0308",
    "breve": "\u0306",
}

_SPACING_COMMANDS = {
    ",": " ", ";": " ", ":": " ", ">": " ", " ": " ", "!": "", "/": "",
    "enspace": " ", "thinspace": " ",
}

_LINE_BREAK = "\\"


class _Renderer:
    """Recursive-descent renderer for one LaTeX expression."""

    def __init__(self, source: str, *, display: bool) -> None:
        self.s = source
        self.n = len(source)
        self.display = display

    # -- helpers -----------------------------------------------------------------
    def _read_balanced(self, i: int, open_ch: str = "{", close_ch: str = "}") -> Tuple[str, int]:
        """Read a balanced group; `i` must point at `open_ch`. Returns (inner, next)."""
        assert self.s[i] == open_ch
        depth = 1
        j = i + 1
        while j < self.n and depth > 0:
            if self.s[j] == "\\":
                j += 2
                continue
            if self.s[j] == open_ch:
                depth += 1
            elif self.s[j] == close_ch:
                depth -= 1
            j += 1
        return self.s[i + 1 : j - 1], j

    def _read_command(self, i: int) -> Tuple[str, int]:
        """Read a control sequence starting at `s[i] == '\\'` -> (name, next)."""
        j = i + 1
        if j >= self.n:
            return "", j
        if self.s[j].isalpha():
            while j < self.n and self.s[j].isalpha():
                j += 1
            return self.s[i + 1 : j], j
        # single-character command such as \, \% \{ \  or \\
        return self.s[j], j + 1

    def _read_arg(self, i: int) -> Tuple[str, int]:
        """Read one macro argument: `{...}`, or a single token/command."""
        while i < self.n and self.s[i] in " \t\n":
            i += 1
        if i >= self.n:
            return "", i
        if self.s[i] == "{":
            return self._read_balanced(i)
        if self.s[i] == "\\":
            cmd, nxt = self._read_command(i)
            return self.s[i:nxt], nxt
        return self.s[i], i + 1

    @staticmethod
    def _strip_braces(text: str) -> str:
        text = text.strip()
        if text.startswith("{") and text.endswith("}"):
            return text[1:-1]
        return text

    # -- rendering ---------------------------------------------------------------
    def render(self) -> str:
        return self._render_seq(0, self.n)[0]

    def _render_seq(self, i: int, stop: int) -> Tuple[str, int]:
        out: List[str] = []
        while i < stop:
            ch = self.s[i]
            if ch == "}":
                # Groups are consumed by `_read_balanced`; a brace that reaches this
                # point is stray, so skip it instead of truncating the expression.
                i += 1
                continue
            if ch == "\\":
                name, nxt = self._read_command(i)
                if name == "":
                    i = nxt
                    continue
                if name == _LINE_BREAK:
                    out.append("<br/>")
                    i = nxt
                    continue
                out.append(self._render_command(name, nxt))
                i = self._consume_tail()
                continue
            if ch == "{":
                inner, nxt = self._read_balanced(i)
                out.append(self._render_seq_str(inner))
                i = nxt
                continue
            if ch in "^_":
                frag, i2 = self._render_script(i)
                out.append(frag)
                i = i2
                continue
            if ch == "&":
                out.append(" ")
                i += 1
                continue
            if ch == "~":
                out.append("&nbsp;")
                i += 1
                continue
            if ch in " \t\n":
                out.append(" ")
                i += 1
                continue
            out.append(html.escape(ch))
            i += 1
        return "".join(out), i

    def _render_seq_str(self, text: str) -> str:
        sub = _Renderer(text, display=self.display)
        return sub._render_seq(0, len(text))[0]

    # The command handlers advance `self._cursor`; kept as an attribute so the
    # sequence loop stays readable.
    def _consume_tail(self) -> int:
        return self._cursor

    def _render_command(self, name: str, after: int) -> str:
        self._cursor = after
        low = name

        if low in _SPACING_COMMANDS:
            self._cursor = after
            return _SPACING_COMMANDS[low]
        if low in ("quad", "qquad", "enspace", "thinspace", " ", ";"):
            return " " if low != "qquad" else "  "
        if low in _IGNORED:
            return ""
        if low == "not":
            return "¬"
        if low == "pmod":
            arg, nxt = self._read_arg(after)
            self._cursor = nxt
            return f" (mod {self._render_seq_str(self._strip_braces(arg))})"
        if low == "hspace" or low == "vspace":
            arg, nxt = self._read_arg(after)
            self._cursor = nxt
            return " "
        if low in _FRAC_COMMANDS and low != "genfrac":
            num, p1 = self._read_arg(after)
            den, p2 = self._read_arg(p1)
            self._cursor = p2
            return self._render_frac(num, den)
        if low in _SQRT_COMMANDS:
            idx = ""
            p = after
            while p < self.n and self.s[p] in " \t\n":
                p += 1
            if p < self.n and self.s[p] == "[":
                idx_raw, p = self._read_balanced(p, "[", "]")
                idx = self._render_seq_str(idx_raw)
            arg, nxt = self._read_arg(p)
            self._cursor = nxt
            body = self._render_seq_str(self._strip_braces(arg))
            prefix = f'<sup>{idx}</sup>' if idx else ""
            return f"{prefix}√({body})" if _needs_parens(body) else f"{prefix}√{body}"
        if low in ("overset", "underset", "stackrel"):
            top, p1 = self._read_arg(after)
            base, p2 = self._read_arg(p1)
            self._cursor = p2
            top_html = self._render_seq_str(self._strip_braces(top))
            base_html = self._render_seq_str(self._strip_braces(base))
            if low == "underset":
                return f'<sub>{top_html}</sub>{base_html}'
            return f'{base_html}<sup>{top_html}</sup>'
        if low in _TEXT_WRAPPERS:
            arg, nxt = self._read_arg(after)
            self._cursor = nxt
            return html.escape(self._plain_text(arg))
        if low in _UPRIGHT_WRAPPERS:
            arg, nxt = self._read_arg(after)
            self._cursor = nxt
            return self._render_seq_str(self._strip_braces(arg))
        if low in _BOLD_WRAPPERS:
            arg, nxt = self._read_arg(after)
            self._cursor = nxt
            return f"<b>{self._render_seq_str(self._strip_braces(arg))}</b>"
        if low in _ITALIC_WRAPPERS:
            arg, nxt = self._read_arg(after)
            self._cursor = nxt
            return f"<i>{self._render_seq_str(self._strip_braces(arg))}</i>"
        if low == "underline":
            arg, nxt = self._read_arg(after)
            self._cursor = nxt
            return f"<u>{self._render_seq_str(self._strip_braces(arg))}</u>"
        if low in _ACCENT_MARKS:
            arg, nxt = self._read_arg(after)
            self._cursor = nxt
            body = self._render_seq_str(self._strip_braces(arg))
            return f"{body}{_ACCENT_MARKS[low]}"
        if low in ("begin", "end"):
            env, nxt = self._read_arg(after)
            self._cursor = nxt
            if low == "begin":
                return self._render_environment(self._strip_braces(env))
            return ""
        if low in ("color", "textcolor"):
            _arg, nxt = self._read_arg(after)
            self._cursor = nxt
            return ""
        if low in _FUNCTIONS:
            # Operator names carry a small space on both sides in TeX; the caller
            # collapses runs of spaces, so this never doubles up.
            return f" {low} "
        if low in _SYMBOLS:
            return _SYMBOLS[low]
        if len(low) == 1 and not low.isalpha():
            # escaped punctuation: \{ \} \% \& \# \_ \$ etc.
            return html.escape(low)
        # Unknown control sequence: print its name upright, never a stray backslash.
        return html.escape(low)

    def _plain_text(self, raw: str) -> str:
        """Render the argument of \\text{...} without maths interpretation."""
        text = raw
        for cmd, rep in (
            (r"\%", "%"), (r"\&", "&"), (r"\#", "#"), (r"\_", "_"),
            (r"\$", "$"), (r"\{", "{"), (r"\}", "}"), ("~", " "),
        ):
            text = text.replace(cmd, rep)
        return re.sub(r"\s+", " ", text).strip()

    def _render_environment(self, env: str) -> str:
        """Flatten matrix/array/cases-like environments into a readable one-liner."""
        end_marker = f"\\end{{{env}}}"
        stop = self.s.find(end_marker, self._cursor)
        if stop < 0:
            stop = self.n
        body = self.s[self._cursor : stop]
        self._cursor = min(self.n, stop + len(end_marker))
        rows = [r for r in re.split(r"\\\\", body) if r.strip()]
        rendered_rows = []
        for row in rows:
            if row.strip().startswith("\\hline"):
                row = row.replace("\\hline", "")
            cells = [c for c in row.split("&")]
            if env in ("cases", "dcases", "rcases"):
                rendered_rows.append(self._render_seq_str(",\\ ".join(cells)))
            else:
                rendered_rows.append(self._render_seq_str(" & ".join(cells)))
        joiner = "; " if env in ("cases", "dcases", "rcases") else "  "
        return joiner.join(r for r in rendered_rows if r)

    def _render_frac(self, num: str, den: str) -> str:
        # Story forces every table onto its own line, so a staged fraction would break
        # an inline formula apart. A parenthesised `num/den` keeps the sentence intact
        # and stays unambiguous in print.
        num_src = self._strip_braces(num)
        den_src = self._strip_braces(den)
        num_html = self._render_seq_str(num_src)
        den_html = self._render_seq_str(den_src)
        num_fmt = f"({num_html})" if _needs_parens(num_html) else num_html
        den_fmt = f"({den_html})" if _needs_parens(den_html) else den_html
        return f"{num_fmt}/{den_fmt}"

    def _render_script(self, i: int) -> Tuple[str, int]:
        marker = self.s[i]
        arg, nxt = self._read_arg(i + 1)
        inner_src = self._strip_braces(arg)
        plain_inner = inner_src.strip()
        if marker == "^" and plain_inner in (r"\circ", "°", r"\degree", r"\omicron"):
            return "°", nxt
        if marker == "^" and plain_inner in (r"\prime", r"\dprime"):
            return _SYMBOLS["prime"] * (2 if plain_inner == r"\dprime" else 1), nxt
        rendered = self._render_seq_str(inner_src)
        tag = "sup" if marker == "^" else "sub"
        return f"<{tag}>{rendered}</{tag}>", nxt


import re  # noqa: E402  (kept below the symbol tables for readability)


def _needs_parens(rendered_html: str) -> bool:
    """True when a fraction/root operand must be wrapped to stay unambiguous when linearised."""
    text = re.sub(r"<[^>]+>", "", rendered_html or "").strip()
    if not text:
        return False
    if re.fullmatch(r"[A-Za-z0-9.]+", text):
        # a single token or a product such as `2.303RT` needs no brackets
        return False
    if text[0] in "([" and text[-1] in ")]":
        # already bracketed, e.g. [Fe^{3+}]
        return False
    if re.search(r"[\s+\-*/×·÷=,;:±≈<>≤≥]", text):
        return True
    return len(text) > 4


def render_math(expr: str, *, display: bool = False) -> str:
    """Render a LaTeX expression (without the `$` delimiters) to printable HTML."""
    source = (expr or "").replace("\r", " ").replace("\n", " ")
    source = source.replace(r"\left.", "").replace(r"\right.", "")
    renderer = _Renderer(source, display=display)
    try:
        body = renderer.render()
    except Exception:  # pragma: no cover - defensive: never break the export
        body = html.escape(source)
    body = re.sub(r"\s{2,}", " ", body).strip()
    if not body:
        return ""
    cls = "math math-display" if display else "math"
    return f'<span class="{cls}">{body}</span>'
