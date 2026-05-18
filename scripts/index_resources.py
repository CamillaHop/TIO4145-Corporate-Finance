#!/usr/bin/env python3
"""Walk resources/ and write generated/resources.json so the section pages
+ the curriculum overview can list their source PDFs.

Output schema:
    {
      "section_01": [
        { "name": "1-introductionAndBackground.pdf",
          "path": "resources/section_01/1-introductionAndBackground.pdf",
          "kind": "slides" },
        { "name": "chap1-5and7.pdf",
          "path": "resources/section_01/chap1-5and7.pdf",
          "kind": "book"   }
      ],
      …,
      "_exams": [
        { "year": "2024",
          "exam":      { "name": "2024.pdf",         "path": "…" },
          "solutions": { "name": "2024_solutios.pdf","path": "…" },
          "mcq_solutions": { … } }
      ],
      "_book": { "name": "book.pdf", "path": "resources/_course/book.pdf" }
    }
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RES  = ROOT / 'resources'
OUT  = ROOT / 'generated' / 'resources.json'

def kind_of(name: str) -> str:
    return 'book' if re.match(r'(?i)^(chap|chapter)', name) else 'slides'

def gather_exams() -> list[dict]:
    """Group exam PDFs by year. Each year gets the main exam paper, its
    solutions, and any MCQ variants if present."""
    exam_dir = RES / '_exams'
    if not exam_dir.is_dir():
        return []
    years: dict[str, dict] = {}
    for f in sorted(exam_dir.iterdir()):
        if f.suffix.lower() != '.pdf':
            continue
        m = re.match(r'^(\d{4})(?:_(mcq|solutions|mcq_solutions|solutios))?\.pdf$', f.name, re.I)
        if not m:
            continue
        year = m.group(1)
        slot = (m.group(2) or 'exam').lower()
        # Normalise the misspelt "2024_solutios.pdf" key.
        if slot == 'solutios': slot = 'solutions'
        years.setdefault(year, {'year': year})
        years[year][slot] = {
            'name': f.name,
            'path': f'resources/_exams/{f.name}',
        }
    return [years[y] for y in sorted(years, reverse=True)]

def find_book() -> dict | None:
    book = RES / '_course' / 'book.pdf'
    return {'name': 'book.pdf', 'path': 'resources/_course/book.pdf'} if book.exists() else None

def main() -> None:
    out: dict[str, object] = {}
    for d in sorted(RES.iterdir()):
        if not d.is_dir() or not d.name.startswith('section_'):
            continue
        files = []
        for f in sorted(d.iterdir()):
            if f.suffix.lower() != '.pdf':
                continue
            files.append({
                'name': f.name,
                'path': f'resources/{d.name}/{f.name}',
                'kind': kind_of(f.name),
            })
        out[d.name] = files

    out['_exams'] = gather_exams()
    book = find_book()
    if book:
        out['_book'] = book

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2))
    n_sections = sum(1 for k in out if k.startswith('section_'))
    print(f'wrote {OUT.relative_to(ROOT)} — '
          f'{n_sections} sections, {len(out["_exams"])} exam years'
          + (', textbook included' if book else ''))

if __name__ == '__main__':
    main()
