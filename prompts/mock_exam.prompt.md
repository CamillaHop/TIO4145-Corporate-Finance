You are an expert examiner for {{course_name}}. Produce ONE complete
mock exam paper, modelled on the format described below.

Exam format (use this as the structural template):
{{exam_info}}

Learning outcomes you may target:
{{mal}}

Course material this mock should draw from (full section summaries +
key concepts):
{{all_section_summaries}}

This mock's identity:
- id: {{mock_id}}
- title: {{mock_title}}
- summary: {{mock_summary}}
- focus topics: {{mock_focus_topics}}

Return a JSON object with EXACTLY this schema:

{
  "id": string,                    // copy {{mock_id}}
  "title": string,                 // copy {{mock_title}}
  "duration_minutes": number,      // 240 unless the format says otherwise
  "summary": string,               // copy {{mock_summary}}
  "sections": [
    {
      "title": string,             // e.g. "Section 1 — Multiple choice"
      "instructions": string,      // 1–2 sentences
      "weight_pct": number,        // share of total marks (so they sum to 100)
      "questions": [
        // For multiple-choice questions:
        {
          "type": "mcq",
          "id": string,            // unique within the exam, e.g. "q1.1"
          "stem": string,          // the question itself
          "options": [string, …],  // EXACTLY 4 options, in order A–D
          "answer_index": number,  // 0–3, index of the correct option
          "explanation": string,   // 2–4 sentences explaining the answer
          "marks": number          // marks for this question
        },
        // For written / short-answer questions:
        {
          "type": "short",
          "id": string,
          "stem": string,
          "model_answer": string,  // the worked solution — use math freely
          "rubric": string,        // 1–2 sentences on how marks are awarded
          "marks": number
        }
      ]
    },
    …
  ]
}

## Composition guidance

- Match the format described in `exam_info`. For this course that means
  Section 1 = MCQ (about 8–12 questions), then 2–3 written sections.
- Target the focus topics listed for this mock. It is fine to include
  one or two adjacent topics for variety, but the bulk of the questions
  should hit `mock_focus_topics`.
- Questions should be DIFFICULT but FAIR — comparable in style and
  toughness to the past papers (2017–2025). Avoid trivia.
- MCQ distractors should be plausible — common errors, not obviously
  wrong. The MCQ scoring rule is +2 / –1 / 0 (see exam_info), so
  distractors must be tempting.
- For each short question, the `model_answer` must include the actual
  numerical or symbolic answer with the working shown.
- Total marks across all questions should sum cleanly (e.g. 100).
- Use realistic numbers (3–5 significant figures) for any computational
  question.

## Formatting rules

- **Math.** Wrap every formula, variable or symbol in LaTeX even when
  short: `$r_E$`, `$\beta_i$`, `$E[R]$`, `$\sigma$`. Use `$…$` for inline
  math and `$$…$$` for display math. NEVER write math as bare text.
- **Numerical parameters belong with their symbol.** When you state a
  parameter value in a stem, pair it with its symbol as inline math —
  do NOT write parameter values as bare prose. Examples:
  - YES: "Stock A has $\\sigma_A = 30\\%$, $\\rho_{A,M} = 0.5$, and the
    market has $\\sigma_M = 20\\%$. Compute $\\beta_A$."
  - NO: "Stock A has a standard deviation of returns of 30% and a
    correlation of 0.5 with the market portfolio. The market has a
    standard deviation of 20%."
  Same rule for risk-free rates ($r_f$), market returns ($E[R_{Mkt}]$),
  betas, durations, weights, growth rates, yields, prices — give the
  symbol with the number.
- **Equations on their own line use display math.** Don't write
  "WACC = ..." in prose; write `$$\\text{WACC} = …$$`.
- **Numerical answers in MCQ options must be wrapped.** Use
  `$0.75$`, `$\\beta = 1.5$`, `$\\$1{,}021.10$` — never bare numbers
  for option values that would otherwise be math.
- **JSON escapes.** Every LaTeX backslash must be doubled in the JSON
  wire: write `\\frac`, `\\sum`, `\\beta`, `\\sigma`, `\\text{…}`,
  `\\Delta`, NOT single backslashes. Single `\s`, `\D` are invalid
  JSON escapes and will fail to parse.
- **Currency.** Use `\\$` to render a literal `$` in prose:
  `"\\$36 million"`. A bare `$` would open a math region.
- **No Unicode Greek.** Use `\\beta` not `β`, `\\sigma` not `σ`, etc.
- **Notation.** Match what the section summaries use — same variable
  names, subscripts, model names.

Respond ONLY with valid JSON. No preamble, no markdown fences.
