You are helping a student of {{course_name}} figure out which formulas they can
lean on during the exam (because they are printed on the official formula sheet)
versus which they must memorise.

═══════════════════════════════════════════════════════════════════════════
THE OFFICIAL FORMULA SHEET (text extracted from the PDF; equations may be
garbled, but the LABELS above each formula are reliable)
═══════════════════════════════════════════════════════════════════════════
{{formula_sheet}}

═══════════════════════════════════════════════════════════════════════════
FORMULAS USED IN THIS SECTION ("{{section_title}}")
═══════════════════════════════════════════════════════════════════════════
Each line below is one numbered formula taken from the section's notes:

{{formula_list}}

═══════════════════════════════════════════════════════════════════════════
TASK
═══════════════════════════════════════════════════════════════════════════
For EACH numbered formula, decide whether that SAME formula is provided on the
official formula sheet above. Match by meaning and by the sheet's labels (e.g.
"CAPM", "Beta", "Portfolio variance", "WACC", "Black Scholes Model", "Present
Value of Annuity") — NOT by exact LaTeX, since the sheet text is messy.

Be strict: mark `on_sheet` true ONLY if the sheet genuinely contains that
formula. A rearrangement or a special case of a sheet formula does NOT count
unless it is itself printed. Examples for this course:
- CAPM, beta, portfolio variance/return, WACC, cost/beta of levered equity,
  binomial (Δ, B) and Black–Scholes (C, d₁, d₂), PV of annuity/perpetuity,
  mean/variance/SD/covariance/correlation of returns → typically ON the sheet.
- Bond price / yield to maturity, dividend-discount / Gordon growth, free cash
  flow / enterprise value, sustainable growth $g$, MM propositions, tax shield,
  put–call parity → typically NOT on the sheet.

Give each formula a short human-readable `name` (e.g. "CAPM", "Gordon Growth
Model").

═══════════════════════════════════════════════════════════════════════════
OUTPUT SCHEMA (return exactly this, one JSON object)
═══════════════════════════════════════════════════════════════════════════
{
  "classifications": [
    { "index": 1, "on_sheet": true,  "name": "CAPM" },
    { "index": 2, "on_sheet": false, "name": "Gordon Growth Model" }
  ]
}

Include one entry per numbered formula. Respond ONLY with valid JSON — no
preamble, no markdown fences.
