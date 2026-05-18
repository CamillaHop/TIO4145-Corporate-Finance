"""Generate the four mock exam papers as generated/exam/mock_NN.json.

Reads generated/exam/exam_prep.json (its mock_exams index supplies title,
summary and focus topics per paper), the section summaries, and
context/exam_info.txt + context/MAL.md, then runs the mock_exam prompt
for each one. Skips mocks whose JSON already exists unless --force is set.

Usage:
    python scripts/generate_mock_exams.py
    python scripts/generate_mock_exams.py --mock mock_02
    python scripts/generate_mock_exams.py --force
"""
from __future__ import annotations

import argparse
import json
import sys

from config_loader import (
    REPO_ROOT,
    call_llm_json,
    load_config,
    load_context,
    load_prompt,
    render,
    write_json_atomic,
)

VALID_IDS = ("mock_01", "mock_02", "mock_03", "mock_04")


def build_section_summaries(cfg: dict) -> str:
    """Same shape as generate_exam.py — full title + summary + key concepts
    for every section. The mock-exam generator needs to see the breadth
    of the course."""
    sections_dir = REPO_ROOT / "generated" / "sections"
    bits = []
    for section in cfg.get("sections", []):
        sid = section["id"]
        path = sections_dir / f"{sid}.json"
        if not path.exists():
            print(f"  WARN: missing {path.relative_to(REPO_ROOT)} — skipping", file=sys.stderr)
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        bits.append(f"## {data.get('title', sid)}")
        if data.get("summary"):
            bits.append(data["summary"])
        kcs = data.get("key_concepts") or []
        if kcs:
            bits.append("Key concepts:")
            for kc in kcs:
                if isinstance(kc, dict):
                    bits.append(
                        f"- {kc.get('concept', '')}: {kc.get('explanation', '')}"
                    )
        bits.append("")
    return "\n".join(bits)


def load_mock_index() -> list[dict]:
    path = REPO_ROOT / "generated" / "exam" / "exam_prep.json"
    if not path.exists():
        sys.exit(
            "ERROR: generated/exam/exam_prep.json is missing. Run "
            "`python scripts/generate_exam.py` first."
        )
    data = json.loads(path.read_text(encoding="utf-8"))
    mocks = data.get("mock_exams") or []
    if not mocks:
        sys.exit(
            "ERROR: exam_prep.json has no `mock_exams` entries. Re-run "
            "`python scripts/generate_exam.py` against the latest prompt."
        )
    return mocks


def generate_one(mock_meta: dict, summaries: str, ctx: dict, cfg: dict) -> dict:
    template = load_prompt("mock_exam.prompt.md")
    focus = mock_meta.get("focus_topics") or []
    if isinstance(focus, list):
        focus_str = ", ".join(focus)
    else:
        focus_str = str(focus)

    prompt = render(
        template,
        {
            "course_name":            cfg["course_name"],
            "exam_info":              ctx["exam_info"],
            "mal":                    ctx["mal"],
            "all_section_summaries":  summaries,
            "mock_id":                mock_meta.get("id", ""),
            "mock_title":             mock_meta.get("title", ""),
            "mock_summary":           mock_meta.get("summary", ""),
            "mock_focus_topics":      focus_str,
        },
    )

    print(f"▶ calling LLM for {mock_meta.get('id')}…")
    data = call_llm_json(prompt, max_tokens=16000)
    if not isinstance(data, dict):
        raise ValueError(f"LLM returned non-object for {mock_meta.get('id')}")
    if "sections" not in data:
        print(
            f"  WARN: {mock_meta.get('id')} has no `sections` key",
            file=sys.stderr,
        )
    return data


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--mock",
        help="generate only this mock id (e.g. mock_02); default = all four",
    )
    ap.add_argument(
        "--force",
        action="store_true",
        help="regenerate even if generated/exam/<id>.json already exists",
    )
    args = ap.parse_args()

    cfg = load_config()
    ctx = load_context()
    summaries = build_section_summaries(cfg)
    if not summaries.strip():
        sys.exit(
            "ERROR: no section JSONs found. Run "
            "`python scripts/generate_sections.py` first."
        )

    index = load_mock_index()
    if args.mock:
        if args.mock not in VALID_IDS:
            sys.exit(f"ERROR: --mock must be one of {VALID_IDS}")
        index = [m for m in index if m.get("id") == args.mock]
        if not index:
            sys.exit(f"ERROR: {args.mock} not present in exam_prep.json mock_exams index")

    out_dir = REPO_ROOT / "generated" / "exam"
    out_dir.mkdir(parents=True, exist_ok=True)
    done = 0
    skipped = 0
    for mock_meta in index:
        mid = mock_meta.get("id")
        if mid not in VALID_IDS:
            print(f"  WARN: skipping unknown mock id '{mid}'", file=sys.stderr)
            continue
        out_path = out_dir / f"{mid}.json"
        if out_path.exists() and not args.force:
            print(f"  ✓ {mid} already exists — skipping (use --force to regenerate)")
            skipped += 1
            continue
        data = generate_one(mock_meta, summaries, ctx, cfg)
        write_json_atomic(out_path, data)
        print(f"  wrote {out_path.relative_to(REPO_ROOT)}")
        done += 1

    print(f"\nGenerated {done} mock exam(s); skipped {skipped}.")


if __name__ == "__main__":
    main()
