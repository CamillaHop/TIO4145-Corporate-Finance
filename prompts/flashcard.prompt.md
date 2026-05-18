You are an expert tutor for {{course_name}}.

Given the following section content, generate 10–20 flashcards for active recall studying.

Section: {{section_title}}
Content:
{{section_content}}

Each flashcard should be:
{ "front": "question or prompt", "back": "answer", "difficulty": "easy|medium|hard" }

## Formatting rules

- **Math.** Wrap every formula, variable or symbol in LaTeX even when short:
  `$r_E$`, `$\beta_i$`, `$E[R]$`, `$\sigma$`. Use `$…$` for inline math
  and `$$…$$` for display math. NEVER write math as bare text.
- **JSON escapes.** Inside JSON strings, every LaTeX backslash must be
  doubled. The wire JSON should have `\\frac`, `\\sum`, `\\beta`,
  `\\sigma`, `\\text{…}`, `\\Delta`, `\\cdot`, `\\times` — NOT single
  backslashes. (Single-backslash sequences like `\s`, `\D` are invalid
  JSON escapes and will fail to parse.)
- **Currency.** Use `\\$` inside JSON strings to render a literal `$`:
  for example `"price: \\$36.00"`. Do not use a bare `$` in prose
  because it would open a math region.
- **No Greek symbols as Unicode.** Write `\\beta` not `β`, `\\sigma`
  not `σ`. Unicode Greek won't render through KaTeX.
- **Lean on the source.** Reuse the exact notation from the section
  content; don't paraphrase variables.

Return ONLY a JSON array of flashcard objects. No preamble, no markdown fences.
