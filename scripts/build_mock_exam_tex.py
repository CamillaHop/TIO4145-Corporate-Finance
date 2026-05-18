"""Render each generated/exam/mock_NN.json into a LaTeX project zipped
up for Overleaf:

    generated/exam/tex/mock_NN.zip
        ├── mock_NN.tex            # questions only
        ├── mock_NN_solutions.tex  # questions + model answers
        └── README.md              # how to open in Overleaf

Pure-Python — no PDF libs, no system deps. The math in the JSON is
already LaTeX (`$…$`, `$$…$$`, `\\beta` etc.), so we pass it through.
Markdown-style `**bold**` and `*italic*` get converted; everything else
is treated as plain LaTeX.

Usage:
    python scripts/build_mock_exam_tex.py
    python scripts/build_mock_exam_tex.py --mock mock_02
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
import zipfile
from pathlib import Path

from config_loader import REPO_ROOT

VALID_IDS = ("mock_01", "mock_02", "mock_03", "mock_04")

PREAMBLE = r"""\documentclass[11pt,a4paper]{article}

% --- Geometry & fonts ------------------------------------------------------
\usepackage[margin=2.2cm]{geometry}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{lmodern}
\usepackage{microtype}

% --- Math ------------------------------------------------------------------
\usepackage{amsmath,amssymb,amsthm}
\usepackage{mathtools}
\usepackage{siunitx}

% --- Lists, tables, boxes --------------------------------------------------
\usepackage{enumitem}
\usepackage{tabularx}
\usepackage{tcolorbox}
\tcbuselibrary{breakable, skins}

% --- Hyperlinks ------------------------------------------------------------
\usepackage[colorlinks=true, urlcolor=teal, linkcolor=teal]{hyperref}

% --- Helpers ---------------------------------------------------------------
\newcommand{\qid}[1]{\textsf{\textbf{\small #1}}\quad}
\newcommand{\qmarks}[1]{\hfill\textsf{\footnotesize[#1\ marks]}}
\newcommand{\sectionweight}[1]{\textsf{\footnotesize{} #1\,\% of marks}}

% Solution boxes: muted teal sidebar
\newtcolorbox{solution}{
  enhanced, breakable,
  colback=cyan!2!white, colframe=teal!60!black,
  arc=2pt, left=8pt, right=8pt, top=4pt, bottom=4pt,
  fontupper=\small,
  borderline west={2.5pt}{0pt}{teal!60!black},
  boxrule=0pt, frame hidden,
}
\newcommand{\soltitle}[1]{\textsf{\footnotesize\textbf{\MakeUppercase{#1}}}\par\vspace{2pt}}

\setlength{\parindent}{0pt}
\setlength{\parskip}{0.4em}

\title{<<<TITLE>>>}
\author{TIØ4145 · Corporate Finance · NTNU}
\date{}

\begin{document}
\maketitle
<<<SUMMARY>>>
\bigskip
"""


# ─────────────────────── Inline markdown → LaTeX ───────────────────────

# Escape the LaTeX special characters that show up in prose. Math is
# already protected — we run replacements outside `$…$` regions only.
LATEX_CHAR_MAP = {
    "%":  r"\%",
    "&":  r"\&",
    "#":  r"\#",
    "_":  r"\_",   # but be careful — _ inside math is fine; we handle that
    "^":  r"\^{}",
    "~":  r"\~{}",
    "<":  r"\textless{}",
    ">":  r"\textgreater{}",
}

# Walk through a string, processing math segments and prose segments
# separately. Math: pass through verbatim. Prose: escape specials and
# apply markdown converters.
MATH_SEGMENT = re.compile(r"(\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]|(?<!\\)\$[^$\n]+?(?<!\\)\$)")


def _escape_prose(s: str) -> str:
    # Markdown **bold** / *italic* / `code` first (they introduce { } in
    # output, which interact with later escapes), then escape the rest.
    s = re.sub(r"\*\*([^*]+)\*\*", r"\\textbf{\1}", s)
    s = re.sub(r"(?<!\w)\*([^*\n]+?)\*(?!\w)", r"\\textit{\1}", s)
    s = re.sub(r"`([^`]+)`", r"\\texttt{\1}", s)
    # Currency: `\$` in source → `\$` in LaTeX (same thing). The single $
    # is already gone because math segments were sliced out before this
    # function runs.
    out = []
    i = 0
    while i < len(s):
        c = s[i]
        # Already-escaped LaTeX (`\textbf{...}` etc.) — pass through token.
        if c == "\\":
            out.append(c)
            i += 1
            if i < len(s):
                out.append(s[i])
                i += 1
            continue
        out.append(LATEX_CHAR_MAP.get(c, c))
        i += 1
    return "".join(out)


def md_to_latex(s) -> str:
    """Convert mixed markdown + LaTeX-math to pure LaTeX."""
    if s is None:
        return ""
    text = str(s)
    # Newlines become paragraph breaks in LaTeX.
    parts = []
    last = 0
    for m in MATH_SEGMENT.finditer(text):
        parts.append(_escape_prose(text[last:m.start()]))
        parts.append(m.group(0))  # math passes through unchanged
        last = m.end()
    parts.append(_escape_prose(text[last:]))
    out = "".join(parts)
    # Soft-break paragraphs on blank lines.
    out = re.sub(r"\n{2,}", r"\n\n", out)
    return out


# ─────────────────────── Section / question writers ───────────────────────

def emit_question(q: dict, *, with_solution: bool) -> str:
    out = []
    qid    = q.get("id", "")
    marks  = q.get("marks")
    head   = f"\\qid{{{md_to_latex(qid)}}}"
    if marks:
        head += f"\\qmarks{{{marks}}}"
    out.append(head)
    out.append(md_to_latex(q.get("stem", "")))

    if q.get("type") == "mcq":
        options = q.get("options") or []
        ans = q.get("answer_index")
        out.append("\\begin{enumerate}[label=\\Alph*., leftmargin=2em, itemsep=2pt]")
        for i, opt in enumerate(options):
            # Strip a leading "A. " / "A: " / "A) " that the LLM sometimes
            # prepends — the enumitem label already prints the letter.
            cleaned = re.sub(r"^\s*[A-Ha-h][\.\):]\s+", "", str(opt))
            text = md_to_latex(cleaned)
            if with_solution and i == ans:
                out.append(f"  \\item[\\textbf{{\\Alph{{enumi}}.}}] \\textbf{{{text}}} \\hfill {{\\color{{teal!60!black}}\\checkmark}}")
            else:
                out.append(f"  \\item {text}")
        out.append("\\end{enumerate}")
        if with_solution and q.get("explanation"):
            out.append("\\begin{solution}")
            out.append("\\soltitle{Why}")
            out.append(md_to_latex(q["explanation"]))
            out.append("\\end{solution}")
    else:  # short
        if with_solution:
            if q.get("model_answer"):
                out.append("\\begin{solution}")
                out.append("\\soltitle{Model answer}")
                out.append(md_to_latex(q["model_answer"]))
                if q.get("rubric"):
                    out.append("\\par\\smallskip\\textit{Rubric:} " + md_to_latex(q["rubric"]))
                out.append("\\end{solution}")
        else:
            # Leave space for handwritten answer.
            out.append("\\vspace{3.2cm}\\hrule height 0pt")
    out.append("")  # blank line between questions
    return "\n".join(out)


def emit_section(sec: dict, *, with_solution: bool) -> str:
    out = []
    title = md_to_latex(sec.get("title", ""))
    weight = sec.get("weight_pct")
    out.append(f"\\section*{{{title}}}")
    if isinstance(weight, (int, float)):
        out.append(f"\\sectionweight{{{int(weight) if weight == int(weight) else weight}}}\\par")
    if sec.get("instructions"):
        out.append(f"\\textit{{{md_to_latex(sec['instructions'])}}}\\par\\smallskip")
    for q in sec.get("questions") or []:
        out.append(emit_question(q, with_solution=with_solution))
    return "\n".join(out)


def build_tex(data: dict, *, with_solution: bool) -> str:
    title = md_to_latex(data.get("title", "Mock exam"))
    if with_solution:
        title += " \\\\ \\large Solutions"
    summary = md_to_latex(data.get("summary", ""))
    duration = data.get("duration_minutes")
    summary_block = (
        f"\\begin{{center}}\\textit{{{summary}}}\\end{{center}}"
        + (f"\\par\\centerline{{\\footnotesize Duration: {duration} minutes}}" if duration else "")
        if summary or duration else ""
    )
    body = "\n".join(
        emit_section(sec, with_solution=with_solution)
        for sec in (data.get("sections") or [])
    )
    preamble = PREAMBLE.replace("<<<TITLE>>>", title).replace("<<<SUMMARY>>>", summary_block)
    return preamble + body + "\n\\end{document}\n"


README = """# {title}

This zip is a ready-to-use Overleaf project for a mock TIØ4145 exam.

## Files

- `{stem}.tex` — questions only. Compile this to get the printable
  question paper with blank answer space after each short question.
- `{stem}_solutions.tex` — questions plus the correct option highlighted
  (for MCQ) and the model answer / rubric (for written questions).

## Opening in Overleaf

1. Go to https://www.overleaf.com.
2. New Project → Upload Project → drop this zip in.
3. Pick the `.tex` you want to compile and click Recompile.

The preamble uses standard packages (`amsmath`, `enumitem`, `tcolorbox`,
`hyperref`) so any reasonably recent TeX Live distribution will compile
it locally too: `latexmk -pdf {stem}.tex`.
"""


def process(mock_id: str) -> None:
    src = REPO_ROOT / "generated" / "exam" / f"{mock_id}.json"
    if not src.exists():
        print(f"  (no JSON for {mock_id}, skipping)")
        return
    data = json.loads(src.read_text(encoding="utf-8"))
    out_dir = REPO_ROOT / "generated" / "exam" / "tex"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_zip = out_dir / f"{mock_id}.zip"

    questions_tex = build_tex(data, with_solution=False)
    solutions_tex = build_tex(data, with_solution=True)
    readme = README.format(title=data.get("title", mock_id), stem=mock_id)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{mock_id}.tex", questions_tex)
        zf.writestr(f"{mock_id}_solutions.tex", solutions_tex)
        zf.writestr("README.md", readme)
    out_zip.write_bytes(buf.getvalue())
    print(f"  wrote {out_zip.relative_to(REPO_ROOT)} ({len(buf.getvalue())//1024} KB)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--mock", help="build only this mock id (e.g. mock_02)")
    args = ap.parse_args()

    ids = [args.mock] if args.mock else list(VALID_IDS)
    for mid in ids:
        if mid not in VALID_IDS:
            sys.exit(f"ERROR: --mock must be one of {VALID_IDS}")
        print(f"▶ {mid}")
        process(mid)


if __name__ == "__main__":
    main()
