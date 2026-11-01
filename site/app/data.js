/* Tahleel data layer: data dictionary from the plan, seeded synthetic data with planted effects,
   CSV import and export, scale scores, and rule-based checks. Runs in the browser and in Node. */
(function (root) {
  'use strict';
  var TS = root.TS || (typeof require !== 'undefined' ? require('./stats.js') : null);
  var G = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : root);

  // ---------- Seeded random numbers ----------
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    var next = function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    var spare = null;
    next.normal = function () {
      if (spare !== null) { var s = spare; spare = null; return s; }
      var u = 0, v = 0; while (u === 0) u = next(); v = next();
      var r = Math.sqrt(-2 * Math.log(u)); spare = r * Math.sin(2 * Math.PI * v); return r * Math.cos(2 * Math.PI * v);
    };
    next.pick = function (weights) { var t = 0, i; for (i = 0; i < weights.length; i++) t += weights[i]; var x = next() * t; for (i = 0; i < weights.length; i++) { x -= weights[i]; if (x <= 0) return i; } return weights.length - 1; };
    return next;
  }
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'scale'; }

  // ---------- Data dictionary ----------
  // kinds: id, duration, likert (ordinal 1..k), categorical (labels), binary (0/1), numeric, text, scale (derived mean)
  function dictionary(S) {
    var TC = G.TC, cols = [];
    cols.push({ id: 'respondent', label: 'Respondent ID', kind: 'id', source: 'meta' });
    cols.push({ id: 'duration_sec', label: 'Time taken (seconds)', kind: 'duration', source: 'meta' });
    if (S.consent && S.consent.on) cols.push({ id: 'consent', label: 'Consent', kind: 'categorical', levels: ['Yes', 'No'], source: 'consent' });
    var qn = 0;
    S.constructs.forEach(function (c, ci) {
      c.questions.forEach(function (q) {
        qn++;
        var id = 'Q' + qn, base = { label: q.text, construct: c.name, constructIndex: ci, qid: q.id, source: 'question', responseType: q.responseType };
        var t = q.responseType;
        if (t === 'likert5' || t === 'likert7') cols.push(Object.assign({ id: id, kind: 'likert', levels: q.options.slice() }, base));
        else if (t === 'rating0_10') cols.push(Object.assign({ id: id, kind: 'numeric', min: 0, max: 10 }, base));
        else if (t === 'numeric') cols.push(Object.assign({ id: id, kind: 'numeric' }, base));
        else if (t === 'yesno') cols.push(Object.assign({ id: id, kind: 'categorical', levels: ['Yes', 'No'] }, base));
        else if (t === 'single') cols.push(Object.assign({ id: id, kind: 'categorical', levels: q.options.slice(), ordered: true }, base));
        else if (t === 'multi') q.options.forEach(function (o, oi) {
          cols.push(Object.assign({ id: id + '_' + (oi + 1), kind: 'binary', levels: ['Not selected', 'Selected'], option: o, group: id }, base, { label: q.text + ': ' + o }));
        });
        else cols.push(Object.assign({ id: id, kind: 'text' }, base));
      });
    });
    if (S.demo && S.demo.on) S.demo.items.forEach(function (did) {
      var it = TC.demoItem(did); if (!it) return;
      if (it.country) {
        cols.push({ id: 'nationality', label: 'Nationality', kind: 'categorical', levels: TC.COUNTRY_CODES.map(function (c) { return TC.countryName(c, 'en'); }), source: 'demo' });
        cols.push({ id: 'nationality_group', label: 'Qatari or non-Qatari', kind: 'categorical', levels: ['Qatari', 'Non-Qatari'], source: 'derived' });
      } else cols.push({ id: did, label: it.label, kind: 'categorical', levels: it.options.slice(), ordered: did === 'age' || did === 'level' || did === 'year', source: 'demo' });
    });
    // One scale score per construct, from its Likert and 0-10 items.
    S.constructs.forEach(function (c, ci) {
      var items = cols.filter(function (x) { return x.constructIndex === ci && (x.kind === 'likert' || (x.kind === 'numeric' && x.responseType === 'rating0_10')); }).map(function (x) { return x.id; });
      if (items.length) cols.push({ id: 'S_' + slug(c.name), label: c.name + ' (scale score)', kind: 'scale', construct: c.name, constructIndex: ci, items: items, source: 'derived' });
    });
    return cols;
  }
  function col(dict, id) { return dict.filter(function (c) { return c.id === id; })[0]; }

  // Scale score: mean of the answered items when at least half are answered.
  function scaleScores(rows, dict) {
    dict.filter(function (c) { return c.kind === 'scale'; }).forEach(function (sc) {
      rows.forEach(function (r) {
        var v = sc.items.map(function (id) { return r[id]; }).filter(function (x) { return typeof x === 'number'; });
        r[sc.id] = v.length >= Math.ceil(sc.items.length / 2) ? Math.round(TS.mean(v) * 1000) / 1000 : null;
      });
    });
    var ng = col(dict, 'nationality_group');
    if (ng) rows.forEach(function (r) { r.nationality_group = r.nationality == null ? null : (r.nationality === 'Qatar' ? 'Qatari' : 'Non-Qatari'); });
    return rows;
  }

  // ---------- Synthetic data ----------
  // Latent factor per construct. Planted effects (by construct position, when the columns exist):
  //  - construct 3 (usually trust) differs by college (or the first multi-level demographic)
  //  - construct 2 (usually usefulness) and construct 1 are higher for postgraduates
  //  - construct 5 relates negatively to construct 4 (guidance vs concern)
  //  - gender and nationality: no effect (null results)
  var NATION_WEIGHTS = { QA: 34, EG: 9, IN: 8, PK: 6, JO: 6, SY: 5, SD: 4, PS: 4, LB: 3, PH: 3, BD: 3, TN: 2, YE: 2, IQ: 2, SA: 1.5, KW: 1, BH: 1, OM: 1, AE: 1, MA: 1, DZ: 1, IR: 1, NP: 1, LK: 1, GB: 0.5, US: 0.5 };
  var DEMO_WEIGHTS = {
    age: [38, 34, 14, 9, 4, 1], gender: [46, 52, 2], level: [74, 20, 6], year: [28, 26, 24, 22], employment: [70, 22, 8],
    college: [17, 15, 10, 18, 11, 6, 8, 5, 10]
  };
  var COLLEGE_SHIFT = [0.1, -0.15, 0.25, 0.55, 0.3, -0.45, 0.4, 0.15, -0.6];
  var LEVEL_SHIFT = [0, 0.85, 1.0];

  function synth(S, opts) {
    opts = opts || {};
    var TC = G.TC, dict = dictionary(S), R = rng(opts.seed || 2026), n = Math.max(30, Math.min(5000, opts.n || 300));
    var nC = S.constructs.length;
    var expected = TC.totalSeconds(S.constructs) + TC.extraSeconds(S);
    var codes = Object.keys(NATION_WEIGHTS), cw = codes.map(function (k) { return NATION_WEIGHTS[k]; });
    var rows = [];
    for (var i = 0; i < n; i++) {
      var r = { respondent: 'R' + String(i + 1).padStart(4, '0') };
      // Demographics
      var demo = {};
      if (S.demo && S.demo.on) S.demo.items.forEach(function (did) {
        var it = TC.demoItem(did); if (!it) return;
        if (it.country) { var code = codes[R.pick(cw)]; r.nationality = TC.countryName(code, 'en'); }
        else { var ix = R.pick(DEMO_WEIGHTS[did] || it.options.map(function () { return 1; })); r[did] = it.options[ix]; demo[did] = ix; }
      });
      if (r.level === 'Undergraduate' && r.age && /30|40/.test(r.age) && R() < 0.7) r.age = '21–24';
      // Latent construct scores
      var g = R.normal(), lat = [];
      for (var c = 0; c < nC; c++) lat[c] = 0.3 * g + 0.95 * R.normal();
      var lvl = demo.level != null ? LEVEL_SHIFT[demo.level] : 0;
      if (nC > 0) lat[0] += 0.8 * lvl;
      if (nC > 1) lat[1] += lvl;
      if (nC > 2) lat[2] += demo.college != null ? COLLEGE_SHIFT[demo.college] * 1.7 : (demo.year != null ? (demo.year - 1.5) * 0.3 : 0);
      if (nC > 4) lat[4] = 0.8 * lat[4] - 0.5 * lat[3];
      // Items
      dict.forEach(function (cdef) {
        if (cdef.source !== 'question') return;
        var L = lat[cdef.constructIndex] || 0, u;
        if (cdef.kind === 'likert') {
          var k = cdef.levels.length, x = 0.78 * L + 0.62 * R.normal() + 0.35;
          u = Math.round((k + 1) / 2 + x * (k - 1) / 3.4);
          r[cdef.id] = Math.max(1, Math.min(k, u));
        } else if (cdef.kind === 'categorical' && cdef.responseType === 'single') {
          var kk = cdef.levels.length, y = 0.75 * L + 0.66 * R.normal();
          u = Math.floor((y + 1.7) / 3.4 * kk);
          r[cdef.id] = cdef.levels[Math.max(0, Math.min(kk - 1, u))];
        } else if (cdef.kind === 'categorical') {
          r[cdef.id] = R() < 1 / (1 + Math.exp(-(0.3 + 0.9 * L))) ? 'Yes' : 'No';
        } else if (cdef.kind === 'binary') {
          var base = [0.4, 0.1, -0.2, -0.7, 0.2][((parseInt(cdef.id.split('_')[1], 10) || 1) - 1) % 5];
          r[cdef.id] = R() < 1 / (1 + Math.exp(-(base + 0.8 * L))) ? 1 : 0;
        } else if (cdef.kind === 'numeric') {
          if (cdef.max === 10) r[cdef.id] = Math.max(0, Math.min(10, Math.round(5.5 + 1.8 * L + 1.3 * R.normal())));
          else r[cdef.id] = Math.max(0, Math.round(10 + 3.5 * L + 3 * R.normal()));
        } else if (cdef.kind === 'text') {
          r[cdef.id] = R() < 0.55 ? '' : ['Saves time on drafts', 'Not sure the answers are right', 'Need clearer rules', 'Useful for coding', 'I avoid it for graded work'][Math.floor(R() * 5)];
        }
      });
      if (S.consent && S.consent.on) r.consent = 'Yes';
      r.duration_sec = Math.round(expected * Math.exp(0.35 * R.normal()));
      rows.push(r);
    }
    // Data problems a real survey has: missing answers, speeders, two duplicates, one straight-liner, two non-consents.
    var qcols = dict.filter(function (c) { return c.source === 'question' && c.kind !== 'text'; }).map(function (c) { return c.id; });
    var dcols = dict.filter(function (c) { return c.source === 'demo'; }).map(function (c) { return c.id; });
    rows.forEach(function (r) {
      qcols.forEach(function (id) { if (R() < 0.04) r[id] = null; });
      dcols.forEach(function (id) { if (R() < 0.02) r[id] = null; });
    });
    var likertCols = dict.filter(function (c) { return c.kind === 'likert'; });
    var nSpeed = Math.max(2, Math.round(n * 0.025));
    for (var s = 0; s < nSpeed; s++) {
      var sr = rows[Math.floor(R() * n)];
      sr.duration_sec = Math.max(8, Math.round(expected * 0.18 * (0.6 + R())));
      likertCols.forEach(function (c) { sr[c.id] = R() < 0.7 ? 3 : sr[c.id]; });
    }
    if (likertCols.length) { var sl = rows[Math.floor(R() * n)]; likertCols.forEach(function (c) { sl[c.id] = c.levels.length; }); }
    for (var dd = 0; dd < 2; dd++) { var src = rows[Math.floor(R() * n)], copy = Object.assign({}, src, { respondent: 'R' + String(rows.length + 1).padStart(4, '0') }); rows.push(copy); }
    if (S.consent && S.consent.on) for (var nc = 0; nc < 2; nc++) { var ncr = rows[Math.floor(R() * rows.length)]; ncr.consent = 'No'; qcols.forEach(function (id) { ncr[id] = null; }); }
    rows.forEach(function (r) { r.nationality_group = undefined; });
    scaleScores(rows, dict);
    return { source: 'synthetic', seed: opts.seed || 2026, created: new Date().toISOString(), columns: dict, rows: rows };
  }

  // ---------- CSV ----------
  function parseCSV(text) {
    var rows = [], row = [], cell = '', q = false, i = 0, c;
    text = String(text || '').replace(/^﻿/, '');
    for (; i < text.length; i++) {
      c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    rows = rows.filter(function (r) { return r.some(function (v) { return String(v).trim() !== ''; }); });
    return { headers: (rows.shift() || []).map(function (h) { return String(h).trim(); }), rows: rows };
  }
  function csvCell(v) { if (v == null) return ''; var s = String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function toCSV(data, which) {
    var cols = data.columns.filter(function (c) { return which === 'all' || c.source !== 'derived'; });
    var lines = [cols.map(function (c) { return csvCell(c.id); }).join(',')];
    data.rows.forEach(function (r) { lines.push(cols.map(function (c) { return csvCell(r[c.id]); }).join(',')); });
    return lines.join('\n') + '\n';
  }
  // Match uploaded headers to dictionary columns: exact id, then label words.
  function matchColumns(headers, dict) {
    var norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); };
    var used = {}, map = {};
    headers.forEach(function (h) {
      var hn = norm(h), hit = dict.filter(function (c) { return c.source !== 'derived' && !used[c.id] && (norm(c.id) === hn || norm(c.label) === hn); })[0];
      if (!hit) {
        var hw = hn.split(' ').filter(function (w) { return w.length > 3; }), best = null, bestScore = 0;
        dict.forEach(function (c) {
          if (c.source === 'derived' || used[c.id]) return;
          var cw = norm(c.label).split(' '), sc = hw.filter(function (w) { return cw.indexOf(w) > -1; }).length / Math.max(1, hw.length);
          if (sc > bestScore) { bestScore = sc; best = c; }
        });
        if (best && bestScore >= 0.6) hit = best;
      }
      if (hit) { map[h] = hit.id; used[hit.id] = true; } else map[h] = '';
    });
    return map;
  }
  // Build a dataset from parsed CSV with a header-to-column map. Likert labels and numbers are both accepted.
  function fromCSV(parsed, map, dict) {
    var rows = parsed.rows.map(function (cells, ri) {
      var r = {};
      parsed.headers.forEach(function (h, i) {
        var id = map[h]; if (!id) return;
        var c = col(dict, id), raw = cells[i] == null ? '' : String(cells[i]).trim(), v = raw === '' ? null : raw;
        if (v !== null && (c.kind === 'likert')) {
          var num = Number(v), li = c.levels.map(function (x) { return x.toLowerCase(); }).indexOf(v.toLowerCase());
          v = li > -1 ? li + 1 : (isFinite(num) ? num : null);
        } else if (v !== null && (c.kind === 'numeric' || c.kind === 'duration')) { v = Number(v); if (!isFinite(v)) v = null; }
        else if (v !== null && c.kind === 'binary') { v = /^(1|yes|true|selected)$/i.test(v) ? 1 : 0; }
        r[id] = v;
      });
      if (!r.respondent) r.respondent = 'R' + String(ri + 1).padStart(4, '0');
      return r;
    });
    scaleScores(rows, dict);
    return { source: 'upload', created: new Date().toISOString(), columns: dict, rows: rows };
  }

  // ---------- Checks (flagged, never deleted) ----------
  function checks(data) {
    var dict = data.columns, rows = data.rows, out = [];
    var qcols = dict.filter(function (c) { return c.source === 'question' && c.kind !== 'text'; });
    var likert = dict.filter(function (c) { return c.kind === 'likert'; });
    var add = function (id, label, detail, idx, recommend) { if (idx.length) out.push({ id: id, label: label, detail: detail, rows: idx, recommend: recommend }); };
    if (dict.some(function (c) { return c.id === 'consent'; })) add('no_consent', 'Did not consent', 'Answered "No" to the consent question. These responses should not be analysed.', rows.map(function (r, i) { return r.consent === 'No' ? i : -1; }).filter(function (i) { return i > -1; }), 'exclude');
    var miss = rows.map(function (r, i) { var m = qcols.filter(function (c) { return r[c.id] == null; }).length; return m / Math.max(1, qcols.length) > 0.3 && r.consent !== 'No' ? i : -1; }).filter(function (i) { return i > -1; });
    add('missing', 'Many missing answers', 'More than 30% of questions unanswered.', miss, 'exclude');
    var durs = rows.map(function (r) { return r.duration_sec; }).filter(function (v) { return typeof v === 'number'; });
    if (durs.length) {
      var md = TS.median(durs);
      add('speeders', 'Speeders', 'Finished in under 40% of the median time (' + Math.round(md) + ' seconds).', rows.map(function (r, i) { return typeof r.duration_sec === 'number' && r.duration_sec < 0.4 * md ? i : -1; }).filter(function (i) { return i > -1; }), 'exclude');
    }
    var seen = {}, dup = [];
    rows.forEach(function (r, i) { var key = JSON.stringify(qcols.map(function (c) { return r[c.id]; }).concat(dict.filter(function (c) { return c.source === 'demo'; }).map(function (c) { return r[c.id]; }))); if (seen[key] != null) dup.push(i); else seen[key] = i; });
    add('duplicates', 'Duplicates', 'Same answers as an earlier response, apart from the ID.', dup, 'exclude');
    if (likert.length >= 5) add('straight', 'Same answer throughout', 'Gave one identical answer to all ' + likert.length + ' rating items.', rows.map(function (r, i) {
      var v = likert.map(function (c) { return r[c.id]; }).filter(function (x) { return x != null; });
      return v.length === likert.length && v.every(function (x) { return x === v[0]; }) ? i : -1;
    }).filter(function (i) { return i > -1; }), 'review');
    var bad = rows.map(function (r, i) {
      return dict.some(function (c) { var v = r[c.id]; if (v == null) return false;
        if (c.kind === 'likert') return !(v >= 1 && v <= c.levels.length && v === Math.round(v));
        if (c.kind === 'numeric' && c.max != null) return v < c.min || v > c.max;
        return false; }) ? i : -1;
    }).filter(function (i) { return i > -1; });
    add('range', 'Values out of range', 'At least one answer outside the allowed values.', bad, 'exclude');
    return out;
  }
  function activeRows(data, excluded, flags) {
    var drop = {};
    (flags || []).forEach(function (f) { if (excluded[f.id]) f.rows.forEach(function (i) { drop[i] = true; }); });
    return data.rows.filter(function (_, i) { return !drop[i]; });
  }

  var TD = { rng: rng, dictionary: dictionary, col: col, scaleScores: scaleScores, synth: synth, parseCSV: parseCSV, toCSV: toCSV, matchColumns: matchColumns, fromCSV: fromCSV, checks: checks, activeRows: activeRows, slug: slug };
  if (typeof module !== 'undefined' && module.exports) module.exports = TD;
  else root.TD = TD;
})(this);
