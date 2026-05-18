You are an expert tutor preparing a student for the final exam in {{course_name}}.

Exam info:
{{exam_info}}

Learning outcomes:
{{mal}}

Section summaries:
{{all_section_summaries}}

Generate a comprehensive exam preparation guide as a JSON object with:
- "priority_topics": list of { "topic": string, "why_important": string }
- "practice_questions": list of { "question": string, "answer": string, "section": string }
- "key_definitions": list of { "term": string, "definition": string }
- "study_schedule": list of { "day": number, "focus": string, "tasks": list of strings }

## Formatting rules

- **Math.** Wrap every formula, variable or symbol in LaTeX even when
  short: `$r_E$`, `$\beta_i$`, `$E[R]$`, `$\sigma$`. Use `$…$` for inline
  and `$$…$$` for display math. NEVER write math as bare text.
- **JSON escapes.** Every LaTeX backslash must be doubled in the JSON
  wire: write `\\frac`, `\\sum`, `\\beta`, `\\sigma`, `\\text{…}`,
  `\\Delta`, NOT single backslashes. Single `\s`, `\D` are invalid JSON
  escapes and fail to parse.
- **Currency.** Use `\\$` to render a literal `$` in prose: e.g.
  `"\\$36 million"`. A bare `$` would open a math region.
- **No Unicode Greek.** Use `\\beta` not `β`, `\\sigma` not `σ`, etc.
- **Notation.** Match what the section summaries use — same variable
  names, subscripts, model names.

Respond ONLY with valid JSON. No preamble, no markdown fences.
