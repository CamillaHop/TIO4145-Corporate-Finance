"""Generate generated/exercises/<section_id>.json — a summary of the TYPES of
questions asked in the exercise(s) mapped to each section.

The mapping lives in course_config.json: each section may carry an `exercises`
list of repo-relative PDF paths (e.g. "resources/_exercises/Exercise 1.pdf").
Sections with no `exercises` are skipped. Exercise text is read from the
`<stem>.parsed.json` sidecar produced by scripts/parse_resources.py.

Usage:
    python scripts/generate_exercises.py
    python scripts/generate_exercises.py --section section_02
"""
from __future__ import annotations

import argparse
import json
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


def read_exercise_text(rel_path: str) -> str:
    """Return the parsed text of one exercise PDF, or '' if not parsed yet."""
    pdf = REPO_ROOT / rel_path
    parsed = pdf.parent / f"{pdf.stem}.parsed.json"
    if not parsed.exists():
        print(
            f"  WARN: {parsed.relative_to(REPO_ROOT)} not found — run "
            "scripts/parse_resources.py first.",
            file=sys.stderr,
        )
        return ""
    try:
        data = json.loads(parsed.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        print(f"  WARN: could not read {parsed}: {e}", file=sys.stderr)
        return ""
    return _extract_text(data, source=pdf.name)


def generate_one(section: dict, template: str) -> None:
    sid = section["id"]
    exercises = section.get("exercises") or []
    if not exercises:
        return  # no exercise relevant for this section — nothing to write

    text = "\n\n".join(t for t in (read_exercise_text(p) for p in exercises) if t)
    if not text.strip():
        print(f"  SKIP {sid}: no parsed exercise text available.", file=sys.stderr)
        return

    prompt = render(
        template,
        {
            "course_name":         load_config()["course_name"],
            "section_title":       section["title"],
            "section_description": section.get("description", ""),
            "exercise_text":       text,
        },
    )

    print(f"  calling LLM for {sid}…")
    data = call_llm_json(prompt, max_tokens=2000)
    if not isinstance(data, dict) or "question_types" not in data:
        print(f"  ERROR: unexpected LLM output for {sid}", file=sys.stderr)
        return

    out = REPO_ROOT / "generated" / "exercises" / f"{sid}.json"
    write_json_atomic(out, data)
    print(f"  wrote {out.relative_to(REPO_ROOT)}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--section", help="generate only this section id")
    args = ap.parse_args()

    cfg = load_config()
    template = load_prompt("exercise_summary.prompt.md")

    sections = cfg.get("sections", [])
    if args.section:
        sections = [s for s in sections if s["id"] == args.section]
        if not sections:
            sys.exit(f"ERROR: section '{args.section}' not in course_config.json")

    for section in sections:
        if not (section.get("exercises") or []):
            continue
        print(f"▶ {section['id']} — {section['title']}")
        generate_one(section, template)


if __name__ == "__main__":
    main()
