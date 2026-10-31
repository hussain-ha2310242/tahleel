# Tahleel (تحليل)

A research-design workspace for education, social science and public health researchers in Qatar and the Gulf. Version 0.1 takes a study from one sentence to a survey plan: population, sampling design, constructs, questions with response types and times, and flags to review. Each step is confirmed by the researcher.

- `/` landing page
- `/app/` workspace (`/app/?demo=1` or `/demo` opens the demo plan)
- `/api/chat` Groq proxy. The browser never sees the key.

## Layout

| Path | What it is |
|---|---|
| `site/index.html` | Landing page |
| `site/app/` | Workspace: `index.html`, `app.css`, `app-state.js` (state and Groq calls), `app-view.js` (rendering), `app-main.js` (events) |
| `site/assets/` | Shared tokens (`base.css`), icons, defaults, rules and Arabic form text (`common.js`) |
| `netlify/functions/chat.js` | Groq proxy with schema validation and retries |
| `netlify.toml` | Publish `site`, functions folder, redirects, headers |
| `scripts/serve-local.js` | Local server, no Netlify needed |
| `scripts/check-groq.js`, `scripts/test_groq.py` | Key, model and end-to-end checks |
| `archive/` | Earlier UI drafts, brainstorm and notes. Not deployed. |

