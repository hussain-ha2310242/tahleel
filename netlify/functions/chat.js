// Netlify Function: Groq proxy for Tahleel.
// The API key lives only in the GROQ_API_KEY environment variable. It is never sent to the browser.
// Every model reply is validated against the schema the UI renders. Invalid replies are retried once.

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const STAGES = ['population', 'design', 'constructs', 'questions', 'flags'];
const SUB_STAGES = ['population', 'design'];
const INSTRUCTIONS = ['start', 'next', 'prompt', 'regenerate', 'plan', 'translate'];
const FIELD_TYPES = ['text', 'number', 'select', 'multiselect', 'chips', 'range', 'stepper', 'toggle', 'tiles'];
const OPTION_TYPES = ['select', 'multiselect', 'chips', 'tiles'];
const RANGE_TYPES = ['range', 'stepper', 'number'];
const RESPONSE_TYPES = ['likert5', 'likert7', 'single', 'multi', 'rating0_10', 'yesno', 'numeric', 'open'];
const CHOICE_TYPES = ['single', 'multi'];
const FLAG_CATS = ['wording', 'sampling', 'statistics', 'risk'];
const LIMITS = { subSteps: 6, fields: 12, constructs: 8, questions: 6, options: 8, flags: 10, historyItems: 40, stateChars: 12000 };
// gpt-oss-120b by default. If Groq rejects the model or a parameter (HTTP 400 or 404), the call falls back to gpt-oss-20b.
const DEFAULT_MODEL = 'openai/gpt-oss-120b';
const FALLBACK_MODEL = 'openai/gpt-oss-20b';
const MODEL = process.env.GROQ_MODEL || DEFAULT_MODEL;
// Netlify stops synchronous functions after 10 s, so the whole request (call plus retry) fits in 9 s by default.
// The local server sets a longer budget.
function budgetMs() { return Number(process.env.GROQ_BUDGET_MS) || 9000; }

const SYSTEM = `You are the planning engine inside Tahleel, a research-design tool for social science, education and public health in Qatar and the Gulf. Reply with one JSON object and nothing else.

Stages, in order: population, design, constructs, questions, flags.
- population: the target population. Create 2 to 5 sub-steps that suit this objective (for example who, where, eligibility, size) and the fields for each. Always include two chips fields: include (inclusion criteria) and exclude (exclusion criteria), each with 3 to 5 short options. Give age, when relevant, as a range field.
- design: the study type and sampling. Create 2 to 4 sub-steps that suit the objective.
- constructs: 3 to 6 constructs. Each has a name and a one-sentence description. No questions yet.
- questions: for each construct, 2 to 4 questions. Each question has text and responseType.
- flags: 3 to 6 research-quality items. category is one of wording, sampling, statistics, risk. Make them specific to this plan.

Field types (use only these): text, number, select, multiselect, chips, range, stepper, toggle, tiles.
- select, multiselect, chips and tiles need options (at least 2 strings). Keep each option under 34 characters.
- range needs min, max and value [low, high]. stepper and number need min, max and a number value.
- toggle needs a boolean value.
Each field has: id (lowercase, no spaces), stage (population or design), sub (a sub-step id), label, type, value, and options or min and max where needed. help is optional, one line.

Response types (use only these): likert5, likert7, single, multi, rating0_10, yesno, numeric, open.
- single and multi need options (at least 2 strings).

Rules:
- Research grade: one idea per question, neutral wording, no leading phrases such as "don't you agree" or "obviously".
- Use Qatar and Gulf context where it fits. Write in English.
- Follow the instruction. start: create the population stage. next: create the target stage from the current state. prompt: apply the user's request to the target stage. regenerate: rewrite the target stage, or only the named construct. plan: apply the request to whichever stages it touches. If the plan request is a question or asks for a summary, change nothing and answer in message only (up to 5 short sentences).
- translate: return {"message":"","constructs":[...]} with every construct and question of currentState in the same order and the same counts. Translate name, description, question text and options into Modern Standard Arabic suited to respondents in Qatar. Keep responseType unchanged. Do not add or drop anything.
- Keep what the user has already set in the state. Change only what the request asks for.
- Return only the keys the reply needs. Each stage you return replaces that stage's content.

Output shape:
{"message":"one short sentence on what changed","subSteps":[{"id":"who","label":"Who","stage":"population"}],"fields":[{"id":"who","stage":"population","sub":"who","label":"Who","type":"select","options":["Students","Teachers"],"value":"Students","help":""}],"constructs":[{"name":"AI use","description":"How often students use AI tools.","questions":[{"text":"In the past month, how often did you use AI tools?","responseType":"single","options":["Never","Weekly","Daily"]}]}],"flags":[{"category":"wording","title":"Double-barrelled","detail":"Splits two ideas."}]}`;

function json(status, body) {
  return { statusCode: status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(body) };
}

function str(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }

function sanitizeRequest(b) {
  if (!b || typeof b !== 'object') return { ok: false, error: 'Empty request.' };
  if (INSTRUCTIONS.indexOf(b.instruction) < 0) return { ok: false, error: 'Unknown instruction.' };
  if (STAGES.indexOf(b.target) < 0 && b.target !== 'plan' && b.target !== 'form') return { ok: false, error: 'Unknown target.' };
  const history = (Array.isArray(b.history) ? b.history : []).slice(-LIMITS.historyItems).map(function (h) {
    return { role: str(h && h.role, 12) || 'event', text: str(h && h.text, 300) };
  });
  let state = b.state && typeof b.state === 'object' ? b.state : {};
  let stateText = JSON.stringify(state);
  if (stateText.length > LIMITS.stateChars) stateText = stateText.slice(0, LIMITS.stateChars);
  return {
    ok: true,
    instruction: b.instruction,
    target: b.target,
    objective: str(b.objective, 300),
    prompt: str(b.prompt, 600),
    construct: str(b.construct, 80),
    stateText: stateText,
    history: history
  };
}

function safeState(text) {
  try { return JSON.parse(text); } catch (e) { return {}; }
}

function buildMessages(req) {
  const user = {
    instruction: req.instruction,
    target: req.target,
    objective: req.objective,
    request: req.prompt || null,
    construct: req.construct || null,
    currentState: safeState(req.stateText),
    history: req.history
  };
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: JSON.stringify(user) }
  ];
}

function isId(v) { return typeof v === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,23}$/.test(v); }

// Returns { ok:true, data } with only the allowed keys, or { ok:false, error }.
function validate(d, req) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { ok: false, error: 'Reply must be a JSON object.' };
  const out = { message: str(d.message, req.target === 'plan' ? 700 : 240) };
  const errors = [];
  const target = req.target;

  if (Array.isArray(d.subSteps)) {
    out.subSteps = [];
    d.subSteps.forEach(function (s) {
      if (!s || !isId(s.id) || !str(s.label, 40)) { errors.push('subSteps item needs id and label.'); return; }
      const stage = SUB_STAGES.indexOf(s.stage) > -1 ? s.stage : (SUB_STAGES.indexOf(target) > -1 ? target : null);
      if (!stage) { errors.push('subSteps item needs stage population or design.'); return; }
      out.subSteps.push({ id: s.id, label: str(s.label, 40), stage: stage });
    });
    out.subSteps = out.subSteps.slice(0, LIMITS.subSteps);
  }

  if (Array.isArray(d.fields)) {
    out.fields = [];
    d.fields.forEach(function (f) {
      if (!f || !isId(f.id) || !str(f.label, 60)) { errors.push('field needs id and label.'); return; }
      if (FIELD_TYPES.indexOf(f.type) < 0) { errors.push('field "' + f.id + '" has an unsupported type.'); return; }
      const stage = SUB_STAGES.indexOf(f.stage) > -1 ? f.stage : (SUB_STAGES.indexOf(target) > -1 ? target : null);
      if (!stage) { errors.push('field "' + f.id + '" needs stage population or design.'); return; }
      const field = { id: f.id, stage: stage, sub: str(f.sub, 24), label: str(f.label, 60), type: f.type, value: f.value, help: str(f.help, 140) };
      if (OPTION_TYPES.indexOf(f.type) > -1) {
        const opts = Array.isArray(f.options) ? f.options.map(function (o) { return str(String(o), 60); }).filter(Boolean) : [];
        if (opts.length < 2) { errors.push('field "' + f.id + '" needs at least two options.'); return; }
        field.options = opts.slice(0, LIMITS.options);
      }
      if (RANGE_TYPES.indexOf(f.type) > -1) {
        if (typeof f.min !== 'number' || typeof f.max !== 'number' || f.max <= f.min) { errors.push('field "' + f.id + '" needs numeric min below max.'); return; }
        field.min = f.min; field.max = f.max;
      }
      out.fields.push(field);
    });
    out.fields = out.fields.slice(0, LIMITS.fields);
  }

  if (Array.isArray(d.constructs)) {
    out.constructs = [];
    d.constructs.forEach(function (c) {
      if (!c || !str(c.name, 80)) { errors.push('construct needs a name.'); return; }
      const qs = [];
      (Array.isArray(c.questions) ? c.questions : []).forEach(function (q) {
        if (!q || !str(q.text, 300)) { errors.push('question needs text.'); return; }
        if (RESPONSE_TYPES.indexOf(q.responseType) < 0) { errors.push('question has an unsupported responseType.'); return; }
        const item = { text: str(q.text, 300), responseType: q.responseType };
        if (CHOICE_TYPES.indexOf(q.responseType) > -1) {
          const opts = Array.isArray(q.options) ? q.options.map(function (o) { return str(String(o), 80); }).filter(Boolean) : [];
          if (opts.length < 2) { errors.push('choice question needs at least two options.'); return; }
          item.options = opts.slice(0, LIMITS.options);
        }
        qs.push(item);
      });
      out.constructs.push({ name: str(c.name, 80), description: str(c.description, 200), questions: qs.slice(0, LIMITS.questions) });
    });
    out.constructs = out.constructs.slice(0, LIMITS.constructs);
  }

  if (Array.isArray(d.flags)) {
    out.flags = [];
    d.flags.forEach(function (f) {
      if (!f || !str(f.title, 80)) { errors.push('flag needs a title.'); return; }
      out.flags.push({ category: FLAG_CATS.indexOf(f.category) > -1 ? f.category : 'risk', title: str(f.title, 80), detail: str(f.detail, 240) });
    });
    out.flags = out.flags.slice(0, LIMITS.flags);
  }

  // Shape rules per instruction, so a partial reply cannot blank a stage.
  const generative = req.instruction === 'start' || req.instruction === 'next' || req.instruction === 'regenerate';
  if (req.construct) {
    const c0 = out.constructs && out.constructs[0];
    if (!c0 || !c0.questions.length) errors.push('return the named construct with at least one question.');
  } else if (target === 'population' || target === 'design') {
    if (generative && (!out.fields || out.fields.length < 3 || !out.subSteps || out.subSteps.length < 2)) errors.push('return at least 2 sub-steps and 3 fields.');
    if (!generative && !out.fields && !out.subSteps) errors.push('return the fields or sub-steps that the request changes.');
  } else if (target === 'constructs') {
    if (generative && (!out.constructs || out.constructs.length < 3)) errors.push('return 3 to 6 constructs.');
  } else if (target === 'questions') {
    if (generative && (!out.constructs || out.constructs.length < 2 || out.constructs.some(function (c) { return !c.questions.length; }))) errors.push('return at least 2 constructs, each with 1 or more questions.');
  } else if (target === 'flags') {
    if (generative && (!out.flags || out.flags.length < 1)) errors.push('return at least one flag.');
  } else if (req.instruction === 'translate') {
    const src = safeState(req.stateText).constructs || [];
    const got = out.constructs || [];
    if (got.length !== src.length) errors.push('return all ' + src.length + ' constructs, translated, in the same order.');
    else got.forEach(function (c, i) {
      const n = (src[i].questions || []).length;
      if (c.questions.length !== n) errors.push('construct ' + (i + 1) + ' needs all ' + n + ' questions.');
    });
  } else if (target === 'plan') {
    if (!out.fields && !out.constructs && !out.flags && !out.subSteps && !out.message) errors.push('return the parts of the plan that the request changes, or answer in message.');
  }

  if (errors.length) return { ok: false, error: errors.slice(0, 4).join(' ') };
  return { ok: true, data: out };
}

function requestBody(model, messages) {
  const body = { model: model, messages: messages, response_format: { type: 'json_object' } };
  if (/gpt-oss/.test(model)) {
    // Reasoning models: reasoning tokens count toward the limit, so allow more. Low effort keeps the reply fast.
    body.temperature = 0.3;
    body.max_completion_tokens = 4096;
    body.reasoning_effort = process.env.GROQ_REASONING || 'low';
    body.include_reasoning = false;
  } else {
    body.temperature = 0.2;
    body.max_tokens = 1800;
  }
  return body;
}

const HTTP_HINT = { 401: 'The Groq key was rejected.', 403: 'Groq refused the request.', 413: 'The request was too large for Groq.', 429: 'Groq rate limit reached. Wait a moment and try again.' };

async function callGroq(key, messages, model, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, Math.max(1000, timeoutMs || 9000));
  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify(requestBody(model, messages)),
      signal: ctrl.signal
    });
    if (!res.ok) {
      let detail = '';
      try { const e = await res.json(); detail = e && e.error && typeof e.error.message === 'string' ? ' ' + e.error.message.slice(0, 160) : ''; } catch (err) { detail = ''; }
      return { ok: false, status: res.status, error: (HTTP_HINT[res.status] || 'Groq returned an error.') + ' (HTTP ' + res.status + ')' + detail };
    }
    const j = await res.json();
    const content = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (!content) return { ok: false, error: 'Groq returned no content.' };
    return { ok: true, content: content };
  } catch (e) {
    const cause = e && e.cause && (e.cause.code || e.cause.message);
    if (!(e && e.name === 'AbortError')) return { ok: false, network: true, error: 'Could not reach Groq' + (cause ? ' (' + String(cause).slice(0, 80) + ').' : '.') };
    return { ok: false, error: e && e.name === 'AbortError' ? 'Groq timed out.' : 'Could not reach Groq' + (cause ? ' (' + String(cause).slice(0, 80) + ').' : '.') };
  } finally {
    clearTimeout(timer);
  }
}

async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Use POST.' });
  const key = process.env.GROQ_API_KEY;
  if (!key) return json(500, { ok: false, error: 'GROQ_API_KEY is not set on the server.' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { ok: false, error: 'Body is not JSON.' }); }
  const req = sanitizeRequest(body);
  if (!req.ok) return json(400, { ok: false, error: req.error });

  const messages = buildMessages(req);
  const deadline = Date.now() + budgetMs();
  let model = MODEL;
  for (let attempt = 0; attempt < 2; attempt++) {
    const left = deadline - Date.now();
    if (attempt > 0 && left < 2500) break;
    const reply = await callGroq(key, messages, model, left);
    if (!reply.ok && reply.network && deadline - Date.now() > 2000) {
      // A dropped keep-alive connection (UND_ERR_SOCKET, ECONNRESET): one immediate retry on a fresh connection.
      const again = await callGroq(key, messages, model, deadline - Date.now());
      if (again.ok || !again.network) Object.assign(reply, again, { network: again.network || false });
    }
    if (!reply.ok) {
      // Groq could not produce valid JSON (HTTP 400 "Failed to generate JSON"): ask again with a reminder.
      if (reply.status === 400 && /failed to generate json|json_validate_failed/i.test(reply.error) && attempt === 0) {
        messages.push({ role: 'user', content: 'Reply with one valid JSON object only, following the output shape. No other text.' });
        continue;
      }
      if ((reply.status === 400 || reply.status === 404) && model !== FALLBACK_MODEL && attempt === 0) { model = FALLBACK_MODEL; continue; }
      return json(502, { ok: false, error: reply.error });
    }
    let parsed;
    try { parsed = JSON.parse(reply.content); } catch (e) { parsed = null; }
    const v = parsed ? validate(parsed, req) : { ok: false, error: 'Reply was not valid JSON.' };
    if (v.ok) return json(200, { ok: true, data: v.data });
    if (attempt === 0) {
      messages.push({ role: 'assistant', content: reply.content.slice(0, 4000) });
      messages.push({ role: 'user', content: 'That reply did not match the schema: ' + v.error + ' Return the full corrected JSON object only.' });
    }
  }
  return json(502, { ok: false, error: 'The planning reply did not match the schema. Try again.' });
}

exports.handler = handler;
exports.validate = validate;
exports.sanitizeRequest = sanitizeRequest;
exports.buildMessages = buildMessages;
exports.SYSTEM = SYSTEM;
exports.MODEL = MODEL;
exports.FALLBACK_MODEL = FALLBACK_MODEL;
exports.requestBody = requestBody;
