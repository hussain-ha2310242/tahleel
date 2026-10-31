// One small Groq request to confirm the key and model work. Never prints the key.
// Usage: node scripts/check-groq.js            (uses GROQ_MODEL from .env, or openai/gpt-oss-120b)
//        node scripts/check-groq.js llama-3.3-70b-versatile
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const key = process.env.GROQ_API_KEY;
const model = process.argv[2] || process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
if (!key) { console.log('GROQ_API_KEY is missing. Add it to .env in the project folder.'); process.exit(1); }

const body = {
  model,
  messages: [
    { role: 'system', content: 'Reply with one JSON object only.' },
    { role: 'user', content: 'Return {"ok":true,"population":"<one short target population for a survey on AI use at Qatar University>"}' }
  ],
  response_format: { type: 'json_object' }
};
if (/gpt-oss/.test(model)) Object.assign(body, { max_completion_tokens: 512, reasoning_effort: 'low', include_reasoning: false, temperature: 0.3 });
else Object.assign(body, { max_tokens: 200, temperature: 0.2 });

const t0 = Date.now();
fetch('https://api.groq.com/openai/v1/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
  body: JSON.stringify(body)
}).then(async (res) => {
  const ms = Date.now() - t0;
  const j = await res.json().catch(() => ({}));
  console.log(`Model: ${model}`);
  console.log(`HTTP ${res.status} in ${ms} ms`);
  if (!res.ok) {
    console.log('Error: ' + ((j.error && j.error.message) || 'no detail'));
    if (res.status === 401) console.log('The key was rejected. Check GROQ_API_KEY in .env.');
    process.exit(1);
  }
  const content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  console.log('Reply: ' + String(content).slice(0, 300));
  try { JSON.parse(content); console.log('JSON mode works. Groq is ready.'); }
  catch (e) { console.log('The reply was not valid JSON. Try: node scripts/check-groq.js llama-3.3-70b-versatile'); process.exit(1); }
}).catch((e) => {
  console.log('Could not reach Groq: ' + (e && e.cause && e.cause.code ? e.cause.code : e.message));
  process.exit(1);
});
