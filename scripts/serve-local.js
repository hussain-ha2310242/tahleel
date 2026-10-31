// Local preview server, no Netlify CLI needed.
// Serves site/ and runs netlify/functions/chat.js at /api/chat, the same route netlify.toml sets up.
// Usage: node scripts/serve-local.js   (reads GROQ_API_KEY from .env; PORT defaults to 8080)
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const site = path.join(root, 'site');
const port = Number(process.env.PORT) || 8080;

// Load .env without a dependency. Variables already set in the shell win.
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// No 10 s cap locally, so allow the Groq call more time than on Netlify.
if (!process.env.GROQ_BUDGET_MS) process.env.GROQ_BUDGET_MS = '25000';

const chat = require(path.join(root, 'netlify/functions/chat.js'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 2e6) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let p = decodeURIComponent(url.pathname);

    if (p === '/api/chat') {
      const body = req.method === 'POST' ? await readBody(req) : '';
      const out = await chat.handler({ httpMethod: req.method, body, headers: req.headers });
      return send(res, out.statusCode, { 'Content-Type': 'application/json', ...(out.headers || {}) }, out.body);
    }
    if (p === '/demo') return send(res, 302, { Location: '/app/?demo=1' }, '');
    if (p === '/app') return send(res, 302, { Location: '/app/' + url.search }, '');
    if (p.endsWith('/')) p += 'index.html';

    const file = path.normalize(path.join(site, p));
    if (!file.startsWith(site + path.sep)) return send(res, 403, { 'Content-Type': 'text/plain' }, 'Forbidden');
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, { 'Content-Type': 'text/plain' }, 'Not found');
      send(res, 200, {
        'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      }, data);
    });
  } catch (err) {
    send(res, 500, { 'Content-Type': 'text/plain' }, 'Server error');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${port} is already in use. An older Tahleel server is probably still running.`);
    console.log(`Stop it with:  lsof -ti :${port} | xargs kill`);
    console.log('Then run this script again.');
    process.exit(1);
  }
  throw err;
});

server.listen(port, () => {
  const key = process.env.GROQ_API_KEY ? 'loaded' : 'MISSING (add GROQ_API_KEY to .env)';
  console.log(`Tahleel local: http://localhost:${port}`);
  console.log(`Groq key: ${key}`);
  console.log(`Model: ${chat.MODEL} (falls back to ${chat.FALLBACK_MODEL})`);
});
