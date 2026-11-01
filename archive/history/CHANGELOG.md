# Changelog

## 2026-10-31

- Renamed the project to Tahleel.
- Replaced the per-feature and phase files with one features page.
- Replaced the phase stages with versions 0, 1, 3 and 4. Dropped Validate and the pilot check from the page.
- Trimmed `ai/` to `theme.md` and `tests.md`.

## 2026-10-31 · Version 0.1

- First deployable build: landing page and workspace in `site/`, Groq proxy in `netlify/functions/chat.js`.
- Five confirmed stages (population, design, constructs, questions, flags), then an editable plan with a plan chat.
- Form preview in English or Arabic. Arabic comes from Groq per version of the questionnaire; the demo ships with a hand translation.
- Model `openai/gpt-oss-120b` with `openai/gpt-oss-20b` as fallback. Local server and test scripts in `scripts/`.

## 2026-11-01 · Version 0.2

- Data to report: Plan, Data, Analysis and Report tabs in the workspace.
- Optional consent (English and Arabic text) and demographics (seven items, nationality with all countries) in the plan and form preview.
- Synthetic data with planted effects, CSV upload with column matching, rule-based checks with keep or leave out.
- Statistics library and 14-module analysis pool in JavaScript, validated against scipy and statsmodels (121 values).
- Groq plans analyses by picking modules from the pool (no code writing) and writes the report story from computed results only.
