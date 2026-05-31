"""Generate generated/formula_sheet/<section_id>.json — for each section, split
its formulas into "provided on the official formula sheet" vs "must memorise".

Pipeline:
  1. Read the parsed official formula sheet text (resources/_course/*.parsed.json
     whose name contains "formula"). Run parse_resources.py first.
  2. Extract the section's display formulas ($$…$$) from generated/sections/<id>.json
     using the SAME rules as the web's extractGeneralFormulas (skip worked-example
     callouts and numeric instances), so the stored LaTeX matches what the
     Formulas page extracts and badge-matching is reliable.
  3. One LLM call classifies each formula as on-sheet or not.
  4. Write { "on_sheet": [{name, latex}], "memorize": [{name, latex}] } where
     `memorize` is limited to the section's key-concept formulas that are NOT on
     the sheet (the curated must-knows), keeping the panel short.

Usage:
    python scripts/generate_formula_sheet.py
    python scripts/generate_formula_sheet.py --section section_03
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from config_loader import (
    REPO_ROOT,
    _extract_text,
    call_llm_json,
    load_config,
    load_prompt,
    render,
    write_json_atomic,
)

# ── Python port of web/assets/main.js extractGeneralFormulas ──────────────
_EXAMPLE_LABELS = {
    "worked example", "example", "proof", "exercise", "computation", "calculation",
}
_CALLOUT_LABEL_RE = re.compile(r"^\s*\*\*([^:*(]+?)(\s*\([^)]*\))?:\*\*")
_DISPLAY_RE = re.compile(r"\$\$(.+?)\$\$", re.S)


def _is_heading(line: str) -> bool:
    return re.match(r"^#+\s", line) is not None


def _is_hr(line: str) -> bool:
    return re.match(r"^\s*---+\s*$", line) is not None


def _is_numeric_instance(latex: str) -> bool:
    s = latex.strip()
    if re.search(r"=\s*\\?\$?\s*-?\d+(?:[.,]\d+)?\s*(?:\\?%|\\text\{[^}]*\})?\s*$", s):
        return True
    if re.search(r"\\approx\s*\\?\$?\s*-?\d+(?:[.,]\d+)?", s):
        return True
    return False


def extract_general_formulas(md: str) -> list[str]:
    src = md or ""
    if not src:
        return []
    lines = src.split("\n")
    offsets, off = [], 0
    for ln in lines:
        offsets.append(off)
        off += len(ln) + 1
    in_example = False
    line_ctx: list[bool] = []
    for ln in lines:
        if _is_heading(ln) or _is_hr(ln):
            in_example = False
        m = _CALLOUT_LABEL_RE.match(ln)
        if m:
            in_example = m.group(1).strip().lower() in _EXAMPLE_LABELS
        line_ctx.append(in_example)
    out: list[str] = []
    for m in _DISPLAY_RE.finditer(src):
        idx = m.start()
        line_idx = 0
        for k, o in enumerate(offsets):
            if o > idx:
                break
            line_idx = k
        if line_ctx[line_idx]:
            continue
        latex = m.group(1).strip()
        if _is_numeric_instance(latex):
            continue
        out.append(latex)
    return out


# ── Inputs ────────────────────────────────────────────────────────────────
def load_formula_sheet_text() -> str:
    course = REPO_ROOT / "resources" / "_course"
    if not course.exists():
        return ""
    candidates = [p for p in course.glob("*.parsed.json") if "formula" in p.name.lower()]
    parts = []
    for p in candidates:
        try:
            parts.append(_extract_text(json.loads(p.read_text(encoding="utf-8")), source=p.name))
        except Exception as e:  # noqa: BLE001
            print(f"  WARN: could not read {p}: {e}", file=sys.stderr)
    return "\n\n".join(t for t in parts if t)


def _normalize_latex(s: str) -> str:
    """Mirror of web/assets/main.js normalizeLatex — collapse spacing/brace
    differences so the same formula written in the notes and in a key concept
    de-duplicates to one entry."""
    t = s or ""
    t = re.sub(r"\\tag\{[^}]*\}", "", t)
    # Drop wrapper / spacing commands that never change a formula's meaning.
    t = re.sub(r"\\(left|right|big|Big|bigg|Bigg|boxed|displaystyle|textstyle|mathrm|mathbf|quad|qquad|[,;:!])", "", t)
    t = t.lower()
    t = re.sub(r"[\\\s{}()\[\]_^&]", "", t)
    return t


def collect_section_formulas(data: dict) -> list[dict]:
    """Ordered, de-duplicated formulas with a `from_concept` flag. De-dup is by
    NORMALIZED LaTeX so a formula appearing in both the notes and a key concept
    (often with different spacing) collapses to one; `from_concept` is OR-ed so
    it stays eligible for the 'memorize' list."""
    items: list[dict] = []
    for tex in extract_general_formulas(data.get("detailed_notes", "")):
        items.append({"latex": tex, "from_concept": False})
    for k in data.get("key_concepts", []) or []:
        if isinstance(k, dict):
            for tex in extract_general_formulas(k.get("explanation", "")):
                items.append({"latex": tex, "from_concept": True})
    by_key: dict[str, dict] = {}
    order: list[str] = []
    for it in items:
        key = _normalize_latex(it["latex"])
        if not key:
            continue
        if key in by_key:
            by_key[key]["from_concept"] = by_key[key]["from_concept"] or it["from_concept"]
        else:
            by_key[key] = {"latex": it["latex"], "from_concept": it["from_concept"]}
            order.append(key)
    return [by_key[k] for k in order]


def generate_one(section: dict, sheet_text: str, template: str) -> None:
    sid = section["id"]
    section_path = REPO_ROOT / "generated" / "sections" / f"{sid}.json"
    if not section_path.exists():
        print(f"  SKIP {sid}: {section_path.relative_to(REPO_ROOT)} not generated yet.", file=sys.stderr)
        return

    data = json.loads(section_path.read_text(encoding="utf-8"))
    formulas = collect_section_formulas(data)
    if not formulas:
        write_json_atomic(REPO_ROOT / "generated" / "formula_sheet" / f"{sid}.json",
                          {"on_sheet": [], "memorize": []})
        print(f"  {sid}: no display formulas; wrote empty.")
        return

    numbered = "\n".join(f"{i + 1}. {f['latex']}" for i, f in enumerate(formulas))
    prompt = render(
        template,
        {
            "course_name":   load_config()["course_name"],
            "section_title": section["title"],
            "formula_sheet": sheet_text or "(formula sheet text unavailable)",
            "formula_list":  numbered,
        },
    )

    print(f"  calling LLM for {sid}…")
    result = call_llm_json(prompt, max_tokens=2000)
    classifications = (result or {}).get("classifications", []) if isinstance(result, dict) else []

    on_sheet, memorize = [], []
    seen_on, seen_mem = set(), set()
    for c in classifications:
        if not isinstance(c, dict):
            continue
        idx = c.get("index")
        if not isinstance(idx, int) or not (1 <= idx <= len(formulas)):
            continue
        f = formulas[idx - 1]
        # The model sometimes appends "(duplicate)" to a name; strip it — real
        # duplicates were already collapsed by normalized de-dup upstream.
        name = re.sub(r"\s*\(duplicate\)\s*$", "", str(c.get("name", "")).strip(), flags=re.I)
        entry = {"name": name, "latex": f["latex"]}
        if c.get("on_sheet"):
            if f["latex"] not in seen_on:
                seen_on.add(f["latex"])
                on_sheet.append(entry)
        elif f["from_concept"] and f["latex"] not in seen_mem:
            seen_mem.add(f["latex"])
            memorize.append(entry)

    out = REPO_ROOT / "generated" / "formula_sheet" / f"{sid}.json"
    write_json_atomic(out, {"on_sheet": on_sheet, "memorize": memorize})
    print(f"  wrote {out.relative_to(REPO_ROOT)} ({len(on_sheet)} on sheet, {len(memorize)} to memorize)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--section", help="generate only this section id")
    args = ap.parse_args()

    cfg = load_config()
    template = load_prompt("formula_sheet.prompt.md")
    sheet_text = load_formula_sheet_text()
    if not sheet_text:
        print("  WARN: no parsed formula sheet found under resources/_course/. "
              "Run scripts/parse_resources.py first.", file=sys.stderr)

    sections = cfg.get("sections", [])
    if args.section:
        sections = [s for s in sections if s["id"] == args.section]
        if not sections:
            sys.exit(f"ERROR: section '{args.section}' not in course_config.json")

    for section in sections:
        print(f"▶ {section['id']} — {section['title']}")
        generate_one(section, sheet_text, template)


if __name__ == "__main__":
    main()
