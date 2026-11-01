# Tahleel (تحليل)

A research-design workspace for education, social science and public health researchers in Qatar and the Gulf.

- **v0.1, objective to plan:** population, sampling design, constructs, questions with response types and times, flags, optional consent and demographics, and a form preview in English or Arabic. Each step is confirmed by the researcher.
- **v0.2, data to report:** synthetic or uploaded data, rule-based checks, analysis chosen by an agent from a tested module pool, and a report whose numbers all come from computed results.

- `/` landing page
- `/app/` workspace (`/app/?demo=1` or `/demo` opens the demo plan)
- `/api/chat` Groq proxy. The browser never sees the key.

## How analysis works (v0.2)

- Statistics run in the browser (`site/app/stats.js`, `site/app/pool.js`). No respondent data is sent to Groq.
- Groq is the agent: it picks modules from the pool and sets their variables. It never writes code. Every choice is validated against the pool and the data columns, and you can edit it.
- Each module checks its assumptions (Shapiro-Wilk, Levene, expected counts) and picks the test from a fixed decision table, documented at the top of `pool.js`. A test set by hand that differs from the rule is flagged.
- Pool (14 modules): describe, multiple-choice summary, summary by group, reliability (Cronbach's alpha), normality, compare two groups (Student, Welch, Mann-Whitney), compare three or more groups (ANOVA, Welch ANOVA, Kruskal-Wallis, with Holm-adjusted follow-ups), paired, one-sample, two categorical variables (chi-square, Fisher), correlation (Pearson, Spearman), correlation matrix, linear regression (HC3 when needed), logistic regression.
- Confirmatory tests are Holm-adjusted together. The report story is written by Groq from the results only; any number not found in the results is rejected.

## Validation

`python3 tests/golden/make_reference.py` builds fixed datasets and reference values with scipy and statsmodels; `node tests/golden/check.js` compares the JavaScript statistics with them (121 values, tolerance one part in a million).

## Layout

| Path | What it is |
|---|---|
| `site/index.html` | Landing page |
| `site/app/` | Workspace: `index.html`, `app.css`, `app-state.js` (state and Groq calls), `app-view.js` (plan rendering), `app-work.js` (data, analysis, report), `app-main.js` (events) |
| `site/app/stats.js`, `pool.js`, `data.js` | Statistics library, analysis module pool, data dictionary, synthetic data, CSV, checks |
| `tests/golden/` | Reference values from scipy/statsmodels and the comparison script. Not deployed. |
| `site/assets/` | Shared tokens (`base.css`), icons, defaults, rules and Arabic form text (`common.js`) |
| `netlify/functions/chat.js` | Groq proxy with schema validation and retries |
| `netlify.toml` | Publish `site`, functions folder, redirects, headers |
| `scripts/serve-local.js` | Local server, no Netlify needed |
| `scripts/check-groq.js`, `scripts/test_groq.py` | Key, model and end-to-end checks |
| `archive/` | Earlier UI drafts, brainstorm and notes. Not deployed. |

## Run locally

Needs Node 20 or newer.

1. Create `.env` from `.env.example` and set `GROQ_API_KEY`. The file is git-ignored.
2. `node scripts/serve-local.js`, then open http://localhost:8080. Stop with Ctrl+C.
3. `python3 scripts/test_groq.py` checks the key, the models on your account, JSON replies, and (while the server runs) a real planning call.

If port 8080 is busy, an older server is still running: `lsof -ti :8080 | xargs kill`.

## Groq

- Model: `openai/gpt-oss-120b` (low reasoning effort, JSON mode). On HTTP 400 or 404 it falls back to `openai/gpt-oss-20b`. Set `GROQ_MODEL` to change it.
- Groq is called only when starting a plan, moving to the next stage, sending a prompt, regenerating, asking in the plan chat, switching the form preview to Arabic, planning analyses, or writing the report story. Manual edits, data generation, checks and statistics never call Groq.
- Each request has a 9 second budget on Netlify (its synchronous function limit is 10 seconds) and 25 seconds locally. Override with `GROQ_BUDGET_MS`.
- Invalid replies are retried once with the validation error. A dropped connection is retried once. If Groq is unavailable, the stage loads starter content and says why.

## Deploy on Netlify

1. Push the repo to GitHub. In Netlify: Add new site, Import from Git.
2. Build settings come from `netlify.toml`: no build command, publish `site`, functions `netlify/functions`.
3. Site configuration, Environment variables: add `GROQ_API_KEY` (and optionally `GROQ_MODEL`).
4. Deploy.

Before deploying, rotate the Groq key if it was ever shared, and keep `.env` out of git (`.gitignore` covers it).

Later, the same request and reply contract moves to a Supabase Edge Function, with sign-in and saved plans.
