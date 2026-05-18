"""Generate generated/exam/exam_prep.json from all section JSONs plus
context/exam_info.txt and context/MAL.md.

Usage:
    python scripts/generate_exam.py
"""
from __future__ import annotations

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

REQUIRED_KEYS = {"topic_weights", "recurring_patterns", "key_definitions", "mock_exams"}


def build_section_summaries(cfg: dict) -> str:
    sections_dir = REPO_ROOT / "generated" / "sections"
    bits = []
    for section in cfg.get("sections", []):
        sid = section["id"]
        path = sections_dir / f"{sid}.json"
        if not path.exists():
            print(f"  WARN: missing {path.relative_to(REPO_ROOT)} — skipping", file=sys.stderr)
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        bits.append(f"## {data.get('title', sid)}\n{data.get('summary', '')}")
        kcs = data.get("key_concepts") or []
        if kcs:
            bits.append("Key concepts:")
            for kc in kcs:
                if isinstance(kc, dict):
                    bits.append(f"- {kc.get('concept', '')}: {kc.get('explanation', '')}")
        bits.append("")
    return "\n".join(bits)


def main() -> None:
    cfg = load_config()
    ctx = load_context()
    template = load_prompt("exam_prep.prompt.md")

    summaries = build_section_summaries(cfg)
    if not summaries.strip():
        sys.exit(
            "ERROR: no generated section JSONs found. Run "
            "`python scripts/generate_sections.py` first."
        )

    prompt = render(
        template,
        {
            "course_name":            cfg["course_name"],
            "exam_info":              ctx["exam_info"],
            "mal":                    ctx["mal"],
            "all_section_summaries":  summaries,
        },
    )

    print("▶ calling LLM for exam prep…")
    data = call_llm_json(prompt, max_tokens=16000)

    if not isinstance(data, dict):
        sys.exit("ERROR: LLM returned non-object for exam prep")
    missing = REQUIRED_KEYS - set(data.keys())
    if missing:
        print(f"  WARN: exam prep missing keys: {sorted(missing)}", file=sys.stderr)

    # Sanity-check the mock_exams index — we expect 4 entries with the
    # canonical IDs. Warn (not fatal) if the LLM strayed.
    mocks = data.get("mock_exams") or []
    expected_ids = {"mock_01", "mock_02", "mock_03", "mock_04"}
    if len(mocks) != 4:
        print(f"  WARN: expected 4 mock exams, got {len(mocks)}", file=sys.stderr)
    ids = {m.get("id") for m in mocks if isinstance(m, dict)}
    if ids and ids != expected_ids:
        print(
            f"  WARN: mock_exams ids = {sorted(ids)}, expected {sorted(expected_ids)}",
            file=sys.stderr,
        )

    out = REPO_ROOT / "generated" / "exam" / "exam_prep.json"
    write_json_atomic(out, data)
    print(f"  wrote {out.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
