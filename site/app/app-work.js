/* Tahleel v0.2: Data, Analysis and Report stages. Statistics run in the browser (stats.js, pool.js).
   Groq is called only to plan the analyses (it picks modules from the pool) and to write the report story. */
(function () {
  var TC = window.TC, TA = window.TA, TD = window.TD, TP = window.TP, TS = window.TS, ic = window.TI.ic, esc = TC.esc;
  var DOTS = '<span class="dots"><span></span><span></span><span></span></span>';
  var TABS = [['plan', 'Plan'], ['data', 'Data'], ['analysis', 'Analysis'], ['report', 'Report']];
  var MARK = '#4b4740', GRID = '#ECEAE3', MUTE = '#6B6B70', INK = '#18181B', SURF = '#FFFFFF';

  function S() { return TA.state(); }
  function sizeOf(st) { var f = (st.fields.population || []).filter(function (x) { return x.id === 'size'; })[0]; return f ? Number(f.value) || 300 : 300; }
  function ctxOf(st) { return { rows: TD.activeRows(st.data, st.excluded, st.flags), dict: st.data.columns }; }
  function done(st, k) {
    if (k === 'plan') return true;
    if (k === 'data') return !!st.data;
    if (k === 'analysis') return Object.keys(st.results || {}).length > 0;
    return !!(st.report && st.report.story);
  }
  function enabled(st, k) { return k === 'plan' || k === 'data' || (k === 'analysis' && !!st.data) || (k === 'report' && !!st.data && st.tasks.length > 0); }

  // ---------- Tabs (shown in the plan header) ----------
  TA.workTabs = function (st) {
    return '<nav class="wtabs" aria-label="Stages">' + TABS.map(function (t, i) {
      var on = (st.tab || 'plan') === t[0], ok = done(st, t[0]) && t[0] !== 'plan', en = enabled(st, t[0]);
      return '<button type="button" class="wtab' + (on ? ' on' : '') + '" data-act="wtab" data-v="' + t[0] + '"' + (en ? '' : ' disabled') + (on ? ' aria-current="page"' : '') + '>' +
        '<span class="wn">' + (ok ? ic('check') : (i + 1)) + '</span>' + t[1] + '</button>';
    }).join('') + '</nav>';
  };

  // ---------- Actions ----------
  function setData(st, data) {
    st.data = data; st.flags = TD.checks(data); st.excluded = {}; st.page = 0; st.upload = null;
    st.flags.forEach(function (f) { if (f.recommend === 'exclude') st.excluded[f.id] = true; });
    st.results = {}; st.report = null;
    if (!st.tasks.length) st.tasks = autoTasks(st);
    else st.tasks = st.tasks.filter(function (t) { return !TP.validate(t, st.data.columns); });
    run(st);
  }
  function autoTasks(st) {
    var dict = st.data.columns, out = [], n = 0, add = function (title, module, params) { out.push({ id: 'a' + (++n), title: title, module: module, params: params, source: 'auto' }); };
    dict.filter(function (c) { return c.kind === 'scale' && c.items.length >= 2; }).forEach(function (c) { add('How reliable is the ' + c.construct.toLowerCase() + ' scale?', 'reliability', { scale: c.id }); });
    dict.filter(function (c) { return c.kind === 'scale'; }).forEach(function (c) { add('How do respondents rate ' + c.construct.toLowerCase() + '?', 'describe', { column: c.id }); });
    var seen = {};
    dict.filter(function (c) { return c.kind === 'binary' && c.group && !seen[c.group] && (seen[c.group] = true); }).forEach(function (c) { add('Which options did respondents choose? (' + c.group + ')', 'multi_response', { question: c.group }); });
    var single = dict.filter(function (c) { return c.source === 'question' && c.kind === 'categorical'; })[0];
    if (single) add('How did respondents answer ' + single.id + '?', 'describe', { column: single.id });
    return out;
  }
  function run(st) { st.results = st.data ? TP.runAll(st.tasks, ctxOf(st)) : {}; }

  function compactColumns(st) {
    return st.data.columns.filter(function (c) { return ['id', 'duration', 'text'].indexOf(c.kind) < 0 && c.id !== 'nationality' && c.id !== 'consent'; }).map(function (c) {
      var o = { id: c.id, kind: c.kind, label: String(c.kind === 'scale' ? c.construct + ' (scale)' : c.label).slice(0, 60) };
      if (c.levels && c.kind !== 'binary') o.levels = c.levels.slice(0, 6).concat(c.levels.length > 6 ? ['+' + (c.levels.length - 6) + ' more'] : []);
      if (c.kind === 'scale') o.items = c.items.length;
      if (c.group) o.group = c.group;
      return o;
    });
  }
  function planSummary(st) {
    var v = function (k, id) { var f = (st.fields[k] || []).filter(function (x) { return x.id === id; })[0]; return f ? (Array.isArray(f.value) ? f.value.join(', ') : f.value) : ''; };
    return { objective: st.objective, population: [v('population', 'who'), v('population', 'inst'), v('population', 'region')].filter(Boolean).join(', '), design: [v('design', 'studyType'), v('design', 'method')].filter(Boolean).join(', '), constructs: st.constructs.map(function (c) { return c.name; }) };
  }

  TA.work = {
    tab: function (t) { var st = S(); if (st && enabled(st, t)) { st.tab = t; if (t === 'report' && !st.report) st.report = templateReport(st); } },
    generate: function (seed) {
      var st = S(); if (!st) return;
      var s = seed || (st.data && st.data.source === 'synthetic' ? (st.data.seed % 9973) + 1 : 2026);
      setData(st, TD.synth(st, { seed: s, n: sizeOf(st) }));
      TA.historyPush('edit', 'Generated synthetic data (seed ' + s + ')');
    },
    upload: function (name, text) {
      var st = S(); if (!st) return;
      var parsed = TD.parseCSV(text), dict = TD.dictionary(st);
      if (!parsed.headers.length || !parsed.rows.length) { st.upload = { name: name, error: 'The file has no header row or no data rows.' }; return; }
      if (parsed.rows.length > 5000) parsed.rows = parsed.rows.slice(0, 5000);
      st.upload = { name: name, parsed: parsed, map: TD.matchColumns(parsed.headers, dict), dict: dict };
    },
    setMap: function (h, id) { var st = S(); if (st && st.upload && st.upload.map) st.upload.map[h] = id; },
    useUpload: function () {
      var st = S(); if (!st || !st.upload || !st.upload.parsed) return;
      var mapped = Object.keys(st.upload.map).filter(function (h) { return st.upload.map[h]; }).length;
      if (!mapped) { st.upload.error = 'Match at least one column first.'; return; }
      var d = TD.fromCSV(st.upload.parsed, st.upload.map, st.upload.dict);
      d.file = st.upload.name;
      setData(st, d);
      TA.historyPush('edit', 'Uploaded ' + st.data.file + ' (' + d.rows.length + ' rows)');
    },
    cancelUpload: function () { var st = S(); if (st) st.upload = null; },
    exclude: function (id) { var st = S(); if (!st) return; st.excluded[id] = !st.excluded[id]; run(st); if (st.report) st.report = templateReport(st, st.report); },
    page: function (d) { var st = S(); if (!st || !st.data) return; var max = Math.floor((st.data.rows.length - 1) / 50); st.page = Math.max(0, Math.min(max, st.page + d)); },
    addTask: function (module) {
      var st = S(); if (!st || !st.data || !TP.get(module)) return;
      var m = TP.get(module), params = {};
      m.params.forEach(function (p) { var o = TP.options(st.data.columns, p); if (p.type === 'columns') params[p.key] = o.slice(0, 2).map(function (c) { return c.id; }); else if (p.type === 'choice') params[p.key] = 'auto'; else if (o.length && !p.optional) params[p.key] = o[0].id; });
      st.tasks.push({ id: 'u' + Date.now().toString(36), title: m.label, module: module, params: params, source: 'user' });
      run(st);
    },
    removeTask: function (id) { var st = S(); if (!st) return; st.tasks = st.tasks.filter(function (t) { return t.id !== id; }); delete st.results[id]; run(st); },
    moveTask: function (id, d) { var st = S(); var i = st.tasks.map(function (t) { return t.id; }).indexOf(id), j = i + d; if (i < 0 || j < 0 || j >= st.tasks.length) return; var t = st.tasks[i]; st.tasks[i] = st.tasks[j]; st.tasks[j] = t; },
    setParam: function (id, key, value) {
      var st = S(); var t = st.tasks.filter(function (x) { return x.id === id; })[0]; if (!t) return;
      var pd = TP.get(t.module).params.filter(function (p) { return p.key === key; })[0]; if (!pd) return;
      if (pd.type === 'columns') { var cur = (t.params[key] || []).slice(), ix = cur.indexOf(value); if (ix > -1) cur.splice(ix, 1); else cur.push(value); t.params[key] = cur; }
      else t.params[key] = value;
      run(st);
    },
    setModule: function (id, module) {
      var st = S(); var t = st.tasks.filter(function (x) { return x.id === id; })[0]; var m = TP.get(module); if (!t || !m) return;
      var old = t.params, params = {};
      m.params.forEach(function (p) {
        var o = TP.options(st.data.columns, p).map(function (c) { return c.id; });
        var keep = Object.keys(old).map(function (k) { return old[k]; }).filter(function (v) { return typeof v === 'string' && o.indexOf(v) > -1 && Object.keys(params).map(function (k) { return params[k]; }).indexOf(v) < 0; })[0];
        if (p.type === 'columns') params[p.key] = o.slice(0, 2); else if (p.type === 'choice') params[p.key] = 'auto'; else if (keep) params[p.key] = keep; else if (o.length && !p.optional) params[p.key] = o[0];
      });
      t.module = module; t.params = params; run(st);
    },
    toggle: function (id) { var st = S(); var t = st.tasks.filter(function (x) { return x.id === id; })[0]; if (t) t.open = !(t.open != null ? t.open : t.source !== 'auto'); },
    setTitle: function (id, v) { var st = S(); var t = st.tasks.filter(function (x) { return x.id === id; })[0]; if (t) t.title = v; },
    plan: function () {
      var st = S(); if (!st || !st.data || st.busy) return;
      st.busy = 'analysis'; st.workNote = '';
      var multi = st.data.columns.filter(function (c) { return c.group; }).map(function (c) { return c.group; }).filter(function (g, i, a) { return a.indexOf(g) === i; });
      TA.call('analysis_plan', 'analysis', { plan: planSummary(st), n: ctxOf(st).rows.length, columns: compactColumns(st), multi: multi, pool: TP.spec() }, function (r) {
        st.busy = '';
        if (!r.ok) { st.workNote = 'Tahleel could not plan the analyses. ' + (r.error || '') + ' You can add analyses yourself.'; return; }
        var agent = r.data.tasks.map(function (t, i) { return { id: 'g' + Date.now().toString(36) + i, title: t.title, module: t.module, params: Object.assign({ test: 'auto' }, t.params), why: t.why, source: 'agent' }; });
        agent.forEach(function (t) { var m = TP.get(t.module); if (!m.params.some(function (p) { return p.key === 'test'; })) delete t.params.test; });
        st.tasks = st.tasks.filter(function (t) { return t.source !== 'agent'; }).concat(agent);
        st.workNote = r.data.message || ('Added ' + agent.length + ' analyses.');
        run(st);
        TA.historyPush('assistant', 'Planned ' + agent.length + ' analyses');
      });
    },
    write: function () {
      var st = S(); if (!st || st.busy) return;
      var results = st.tasks.map(function (t) { var r = st.results[t.id]; if (!r || !r.ok) return null; return { id: t.id, title: t.title, test: r.test ? r.test.name : 'Descriptive', reason: r.test ? r.test.reason : '', apa: r.apa || '', effect: r.effect || null, pHolm: r.pHolm != null ? Number(r.pHolm.toPrecision(3)) : null, summary: r.summary, notes: (r.notes || []).slice(0, 2) }; }).filter(Boolean).slice(0, 14);
      if (!results.length) return;
      st.busy = 'report';
      var ctx = ctxOf(st);
      TA.call('report', 'report', { objective: st.objective, synthetic: st.data.source === 'synthetic', n: ctx.rows.length, collected: st.data.rows.length, results: results }, function (r) {
        st.busy = '';
        var base = templateReport(st, st.report);
        if (!r.ok) { base.note = 'Tahleel could not write the story, so the template text is shown. ' + (r.error || ''); st.report = base; return; }
        base.summary = r.data.summary; base.limitations = r.data.limitations || base.limitations; base.story = true; base.note = '';
        r.data.findings.forEach(function (f) { base.stories[f.id] = f.story; });
        st.report = base;
        TA.historyPush('assistant', 'Wrote the report story');
      });
    },
    setReport: function (field, id, v) { var st = S(); if (!st || !st.report) return; if (field === 'story') st.report.stories[id] = v; else st.report[field] = v; },
    download: function (kind) {
      var st = S(); if (!st || !st.data) return;
      var name = TD.slug(st.name) || 'tahleel', body, type = 'text/plain';
      if (kind === 'csv') { body = TD.toCSV(withExcluded(st), 'all'); type = 'text/csv'; name += '-data.csv'; }
      else if (kind === 'template') { body = st.data.columns.filter(function (c) { return c.source !== 'derived'; }).map(function (c) { return c.id; }).join(',') + '\n'; type = 'text/csv'; name += '-template.csv'; }
      else if (kind === 'dict') { body = JSON.stringify(st.data.columns.map(function (c) { return { id: c.id, label: c.label, kind: c.kind, levels: c.id === 'nationality' ? undefined : c.levels, construct: c.construct, items: c.items }; }), null, 2); type = 'application/json'; name += '-dictionary.json'; }
      else if (kind === 'results') { body = JSON.stringify({ plan: st.name, objective: st.objective, generated: new Date().toISOString(), tasks: st.tasks.map(function (t) { return { id: t.id, title: t.title, module: t.module, params: t.params, result: st.results[t.id] }; }) }, null, 2); type = 'application/json'; name += '-results.json'; }
      else if (kind === 'md') { body = reportMarkdown(st); type = 'text/markdown'; name += '-report.md'; }
      else return;
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([body], { type: type + ';charset=utf-8' }));
      a.download = name; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }
  };
  function withExcluded(st) {
    var drop = {};
    st.flags.forEach(function (f) { if (st.excluded[f.id]) f.rows.forEach(function (i) { (drop[i] = drop[i] || []).push(f.label); }); });
    var cols = st.data.columns.concat([{ id: 'excluded', label: 'Excluded (reason)', kind: 'text', source: 'meta' }]);
    return { columns: cols, rows: st.data.rows.map(function (r, i) { return Object.assign({}, r, { excluded: drop[i] ? drop[i].join('; ') : '' }); }) };
  }

  // ---------- Report text ----------
  function templateReport(st, prev) {
    var ctx = ctxOf(st), conf = st.tasks.filter(function (t) { var r = st.results[t.id]; return r && r.ok && r.confirmatory; });
    var sig = conf.filter(function (t) { var r = st.results[t.id]; return (r.pHolm != null ? r.pHolm : r.p) < 0.05; });
    var rep = prev ? Object.assign({}, prev, { stories: Object.assign({}, prev.stories) }) : { stories: {} };
    if (!prev || !prev.story) {
      rep.summary = 'This report analyses ' + ctx.rows.length + ' responses' + (st.data.source === 'synthetic' ? ' of synthetic data' : '') + ' for the objective "' + st.objective + '". ' +
        (conf.length ? sig.length + ' of ' + conf.length + ' tests showed a clear result after Holm adjustment. ' : '') +
        sig.slice(0, 3).map(function (t) { return st.results[t.id].summary; }).join(' ');
      rep.limitations = (st.data.source === 'synthetic' ? 'The data are synthetic: they show how the analysis works, not what respondents think. ' : '') +
        'Answers are self-reported. ' + (/cross-sectional/i.test(planSummary(st).design) ? 'A cross-sectional design shows associations, not causes. ' : '') +
        (/convenience/i.test(planSummary(st).design) ? 'Convenience sampling limits generalisation. ' : '');
    }
    st.tasks.forEach(function (t) { var r = st.results[t.id]; if (r && r.ok && !(prev && prev.story && rep.stories[t.id])) rep.stories[t.id] = r.summary; });
    return rep;
  }
  function reportMarkdown(st) {
    var rep = st.report || templateReport(st), ctx = ctxOf(st), L = [];
    L.push('# ' + st.name, '', '_' + st.objective + '_', '');
    if (st.data.source === 'synthetic') L.push('> Synthetic data (seed ' + st.data.seed + '). Results illustrate the method only.', '');
    L.push('## Summary', '', rep.summary || '', '');
    L.push('## Data and checks', '', dataText(st, ctx), '');
    L.push('## Methods', '', methodsText(st), '');
    L.push('## Findings', '');
    st.tasks.forEach(function (t, i) {
      var r = st.results[t.id]; if (!r || !r.ok) return;
      L.push('### ' + (i + 1) + '. ' + t.title, '', rep.stories[t.id] || r.summary, '');
      if (r.test) L.push('- Test: ' + r.test.name + '. ' + r.test.reason);
      if (r.apa) L.push('- Result: ' + r.apa + (r.pHolm != null ? ' (Holm-adjusted p ' + (r.pHolm < 0.001 ? '< .001' : '= ' + TP.fp(r.pHolm)) + ')' : ''));
      if (r.checks) r.checks.forEach(function (c) { L.push('- Check, ' + c.name + ': ' + (c.value || '') + ' [' + c.verdict + ']'); });
      if (r.table) { L.push('', '| ' + r.table.head.join(' | ') + ' |', '|' + r.table.head.map(function () { return ' --- '; }).join('|') + '|'); r.table.rows.forEach(function (row) { L.push('| ' + row.join(' | ') + ' |'); }); }
      L.push('');
    });
    L.push('## Limitations', '', rep.limitations || '', '', '_Generated by Tahleel. Statistics computed in the browser and validated against scipy and statsmodels._', '');
    return L.join('\n');
  }
  function dataText(st, ctx) {
    var ex = st.flags.filter(function (f) { return st.excluded[f.id]; });
    return (st.data.source === 'synthetic' ? 'Synthetic responses generated from the plan (seed ' + st.data.seed + ')' : 'Uploaded file ' + (st.data.file || '')) + ': ' + st.data.rows.length + ' responses collected. ' +
      (ex.length ? 'Excluded: ' + ex.map(function (f) { return f.label.toLowerCase() + ' (' + f.rows.length + ')'; }).join(', ') + '. ' : 'No responses were excluded. ') +
      ctx.rows.length + ' responses were analysed.';
  }
  function methodsText(st) {
    var used = {};
    st.tasks.forEach(function (t) { var r = st.results[t.id]; if (r && r.ok && r.test) used[r.test.name] = true; });
    return 'Each analysis checked its assumptions first (Shapiro-Wilk for normality, Levene for equal variances, expected counts for chi-square) and chose the test from a fixed decision table. Tests used: ' +
      (Object.keys(used).join(', ') || 'none') + '. Two-sided tests at α = .05. p values of the confirmatory tests were adjusted together with the Holm method. Effect sizes are reported with 95% confidence intervals where available. Scale scores are the mean of the scale items when at least half were answered.';
  }

  // ---------- Charts (SVG) ----------
  function trunc(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function ticks(lo, hi, n) {
    var span = hi - lo || 1, step = Math.pow(10, Math.floor(Math.log10(span / n))), err = span / n / step;
    step *= err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
    var out = []; for (var v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
    return out;
  }
  function fmt(v) { return Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 100) / 100); }
  // Horizontal bar with a 4px rounded data end, square at the baseline.
  function hbar(x0, x1, y, h) {
    var r = Math.min(4, Math.abs(x1 - x0) / 2, h / 2), dir = x1 >= x0 ? 1 : -1;
    if (Math.abs(x1 - x0) < 0.5) return '';
    return 'M' + x0 + ',' + y + 'H' + (x1 - dir * r) + 'Q' + x1 + ',' + y + ' ' + x1 + ',' + (y + r) + 'V' + (y + h - r) + 'Q' + x1 + ',' + (y + h) + ' ' + (x1 - dir * r) + ',' + (y + h) + 'H' + x0 + 'Z';
  }
  function vcol(x, w, y0, y1) {
    var r = Math.min(4, w / 2, (y0 - y1) / 2);
    if (y0 - y1 < 0.5) return '';
    return 'M' + x + ',' + y0 + 'V' + (y1 + r) + 'Q' + x + ',' + y1 + ' ' + (x + r) + ',' + y1 + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y1 + ' ' + (x + w) + ',' + (y1 + r) + 'V' + y0 + 'Z';
  }
  function svg(w, h, body, labelText) { return '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(labelText || 'Chart') + '">' + body + '</svg>'; }
  function txt(x, y, s, a, cls) { return '<text x="' + x + '" y="' + y + '"' + (a ? ' text-anchor="' + a + '"' : '') + ' class="' + (cls || 'cl') + '">' + esc(s) + '</text>'; }
  function ramp(k) {
    var L = [], toHex = function (Lv) { var C = 0.012, h = 85 * Math.PI / 180, a = C * Math.cos(h), b = C * Math.sin(h); var l_ = Lv + 0.3963377774 * a + 0.2158037573 * b, m_ = Lv - 0.1055613458 * a - 0.0638541728 * b, s_ = Lv - 0.0894841775 * a - 1.2914855480 * b; var l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_; var rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s]; return '#' + rgb.map(function (x) { x = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; return Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0'); }).join(''); };
    for (var i = 0; i < k; i++) L.push(toHex(k === 1 ? 0.4 : 0.76 - i * (0.49 / (k - 1))));
    return L;
  }
  function chart(c) {
    if (!c) return '';
    var W = 560, f;
    if (c.type === 'bar') {
      var bars = c.bars.slice(0, 14), lab = Math.min(170, 12 + 6.2 * Math.max.apply(null, bars.map(function (b) { return Math.min(28, String(b.label).length); }))), x0 = lab, pw = W - lab - 52;
      var vmax = Math.max.apply(null, bars.map(function (b) { return Math.max(b.value, b.hi || 0); }).concat([c.unit === '%' ? 10 : 0.1])), vmin = Math.min(0, Math.min.apply(null, bars.map(function (b) { return b.value; })));
      if (c.unit === '%') vmax = Math.min(100, Math.ceil(vmax / 10) * 10);
      var sx = function (v) { return x0 + (v - vmin) / (vmax - vmin) * pw; }, rowH = 26, h = bars.length * rowH + 22, body = '';
      ticks(vmin, vmax, 4).forEach(function (t) { body += '<line x1="' + sx(t) + '" x2="' + sx(t) + '" y1="4" y2="' + (h - 18) + '" class="gl"/>' + txt(sx(t), h - 4, fmt(t) + (c.unit || ''), 'middle', 'ct'); });
      bars.forEach(function (b, i) {
        var y = 6 + i * rowH, base = sx(0);
        body += '<g class="mk" tabindex="0"><title>' + esc(b.label + ': ' + b.value + (c.unit || '')) + '</title>' + txt(lab - 8, y + 12, trunc(b.label, 28), 'end') +
          '<path d="' + hbar(base, sx(b.value), y + 2, 14) + '" fill="' + MARK + '"/>' +
          (b.lo != null ? '<line x1="' + sx(b.lo) + '" x2="' + sx(b.hi) + '" y1="' + (y + 9) + '" y2="' + (y + 9) + '" class="ci"/>' : '') +
          txt(Math.max(sx(b.value), b.hi != null ? sx(b.hi) : 0) + 6, y + 13, fmt(b.value) + (c.unit || ''), 'start', 'cv') + '</g>';
      });
      return svg(W, h, body, c.xLabel || 'Bar chart');
    }
    if (c.type === 'hist') {
      var bins = c.bins, H = 170, padB = 34, pl = 34, pw2 = W - pl - 10, ph = H - padB - 8, cmax = Math.max.apply(null, bins.map(function (b) { return b.count; })) || 1, slot = pw2 / bins.length, cw = Math.min(24, slot - 2), body2 = '';
      var sy = function (v) { return 8 + ph - v / cmax * ph; };
      ticks(0, cmax, 3).forEach(function (t) { body2 += '<line x1="' + pl + '" x2="' + (W - 10) + '" y1="' + sy(t) + '" y2="' + sy(t) + '" class="gl"/>' + txt(pl - 6, sy(t) + 4, fmt(t), 'end', 'ct'); });
      bins.forEach(function (b, i) { var x = pl + i * slot + (slot - cw) / 2; body2 += '<g class="mk" tabindex="0"><title>' + esc(fmt(b.x0) + '–' + fmt(b.x1) + ': ' + b.count) + '</title><path d="' + vcol(x, cw, sy(0), sy(b.count)) + '" fill="' + MARK + '"/></g>'; });
      [0, Math.floor(bins.length / 2), bins.length - 1].forEach(function (i) { body2 += txt(pl + i * slot + slot / 2, H - padB + 16, fmt((bins[i].x0 + bins[i].x1) / 2), 'middle', 'ct'); });
      if (c.xLabel) body2 += txt(pl + pw2 / 2, H - 4, trunc(c.xLabel, 70), 'middle', 'ct');
      return svg(W, H, body2, 'Distribution of ' + (c.xLabel || 'values'));
    }
    if (c.type === 'box') {
      var gs = c.groups.slice(0, 12), lab3 = Math.min(200, 12 + 6.2 * Math.max.apply(null, gs.map(function (g) { return Math.min(32, String(g.label).length + 5); }))), pw3 = W - lab3 - 20;
      var lo = Math.min.apply(null, gs.map(function (g) { return g.min; })), hi = Math.max.apply(null, gs.map(function (g) { return g.max; }));
      if (hi === lo) hi = lo + 1;
      var sx3 = function (v) { return lab3 + (v - lo) / (hi - lo) * pw3; }, rh = 28, H3 = gs.length * rh + 24, body3 = '';
      ticks(lo, hi, 5).forEach(function (t) { body3 += '<line x1="' + sx3(t) + '" x2="' + sx3(t) + '" y1="4" y2="' + (H3 - 20) + '" class="gl"/>' + txt(sx3(t), H3 - 6, fmt(t), 'middle', 'ct'); });
      gs.forEach(function (g, i) {
        var y = 6 + i * rh + 4;
        body3 += '<g class="mk" tabindex="0"><title>' + esc(g.label + ': median ' + fmt(g.med) + ', mean ' + fmt(g.mean) + ', IQR ' + fmt(g.q1) + '–' + fmt(g.q3) + ', n = ' + g.n) + '</title>' + txt(lab3 - 8, y + 12, trunc(g.label, 26) + ' (' + g.n + ')', 'end') +
          '<line x1="' + sx3(g.min) + '" x2="' + sx3(g.max) + '" y1="' + (y + 8) + '" y2="' + (y + 8) + '" class="wh"/>' +
          '<rect x="' + sx3(g.q1) + '" y="' + (y + 1) + '" width="' + Math.max(1, sx3(g.q3) - sx3(g.q1)) + '" height="14" rx="3" fill="#d6d3cb"/>' +
          '<line x1="' + sx3(g.med) + '" x2="' + sx3(g.med) + '" y1="' + (y + 1) + '" y2="' + (y + 15) + '" stroke="' + INK + '" stroke-width="2"/>' +
          '<circle cx="' + sx3(g.mean) + '" cy="' + (y + 8) + '" r="4" fill="' + MARK + '" stroke="' + SURF + '" stroke-width="2"/></g>';
      });
      return svg(W, H3, body3, (c.xLabel || 'Values') + ' by group');
    }
    if (c.type === 'scatter') {
      var pts = c.points, H4 = 240, pl4 = 40, pb = 36, pw4 = W - pl4 - 12, ph4 = H4 - pb - 10;
      var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
      var xl = Math.min.apply(null, xs), xh = Math.max.apply(null, xs), yl = Math.min.apply(null, ys), yh = Math.max.apply(null, ys);
      if (xh === xl) xh = xl + 1; if (yh === yl) yh = yl + 1;
      var sx4 = function (v) { return pl4 + (v - xl) / (xh - xl) * pw4; }, sy4 = function (v) { return 10 + ph4 - (v - yl) / (yh - yl) * ph4; }, body4 = '';
      var R = TD.rng(7);
      ticks(xl, xh, 5).forEach(function (t) { body4 += '<line x1="' + sx4(t) + '" x2="' + sx4(t) + '" y1="10" y2="' + (10 + ph4) + '" class="gl"/>' + txt(sx4(t), H4 - pb + 16, fmt(t), 'middle', 'ct'); });
      ticks(yl, yh, 4).forEach(function (t) { body4 += '<line x1="' + pl4 + '" x2="' + (W - 12) + '" y1="' + sy4(t) + '" y2="' + sy4(t) + '" class="gl"/>' + txt(pl4 - 6, sy4(t) + 4, fmt(t), 'end', 'ct'); });
      pts.forEach(function (p) { var jx = c.jitter ? (R() - 0.5) * 0.3 : 0, jy = c.jitter ? (R() - 0.5) * 0.3 : 0; body4 += '<circle cx="' + sx4(p[0] + jx).toFixed(1) + '" cy="' + sy4(p[1] + jy).toFixed(1) + '" r="3.5" fill="' + MARK + '" fill-opacity=".35"/>'; });
      if (c.line) body4 += '<line x1="' + sx4(xl) + '" y1="' + sy4(c.line[0] + c.line[1] * xl) + '" x2="' + sx4(xh) + '" y2="' + sy4(c.line[0] + c.line[1] * xh) + '" stroke="' + INK + '" stroke-width="2" stroke-linecap="round"/>';
      body4 += txt(pl4 + pw4 / 2, H4 - 4, trunc(c.xLabel || '', 60), 'middle', 'ct') + '<text class="ct" transform="translate(11 ' + (10 + ph4 / 2) + ') rotate(-90)" text-anchor="middle">' + esc(trunc(c.yLabel || '', 40)) + '</text>';
      return svg(W, H4, body4, (c.xLabel || '') + ' against ' + (c.yLabel || ''));
    }
    if (c.type === 'stacked') {
      var rows = c.rows.slice(0, 12), k = c.legend.length;
      if (k > 8) return '';
      var cols = ramp(k), lab5 = Math.min(160, 12 + 6.2 * Math.max.apply(null, rows.map(function (r) { return Math.min(24, String(r.label).length); }))), pw5 = W - lab5 - 10, rh5 = 28;
      var legend = '<div class="legend">' + c.legend.map(function (l, i) { return '<span><i style="background:' + cols[i] + '"></i>' + esc(trunc(l, 30)) + '</span>'; }).join('') + '</div>';
      var H5 = rows.length * rh5 + 6, body5 = '';
      rows.forEach(function (r, i) {
        var y = 4 + i * rh5, x = lab5;
        body5 += txt(lab5 - 8, y + 14, trunc(r.label, 24), 'end');
        r.parts.forEach(function (v, j) {
          var w = v / 100 * pw5; if (w <= 0) return;
          var gap = j < r.parts.length - 1 ? 2 : 0, ww = Math.max(0, w - gap), dark = j >= k / 2;
          body5 += '<g class="mk" tabindex="0"><title>' + esc(r.label + ', ' + c.legend[j] + ': ' + v + '%') + '</title><rect x="' + x.toFixed(1) + '" y="' + y + '" width="' + ww.toFixed(1) + '" height="20" rx="' + (j === 0 || j === r.parts.length - 1 ? 4 : 0) + '" fill="' + cols[j] + '"/>' +
            (ww > String(Math.round(v)).length * 7 + 16 ? txt(x + 6, y + 14, Math.round(v) + '%', 'start', dark ? 'cin' : 'cind') : '') + '</g>';
          x += w;
        });
      });
      return legend + svg(W, H5, body5, 'Stacked percentages');
    }
    if (c.type === 'coef') {
      var terms = c.terms.slice(0, 14), lg = !!c.log, tf = function (v) { return lg ? Math.log(Math.max(1e-3, v)) : v; };
      var lab6 = Math.min(220, 12 + 6.2 * Math.max.apply(null, terms.map(function (t) { return Math.min(34, String(t.label).length); }))), pw6 = W - lab6 - 20;
      var lo6 = Math.min(tf(c.ref), Math.min.apply(null, terms.map(function (t) { return tf(t.lo); }))), hi6 = Math.max(tf(c.ref), Math.max.apply(null, terms.map(function (t) { return tf(t.hi); })));
      if (hi6 === lo6) hi6 = lo6 + 1;
      var sx6 = function (v) { return lab6 + (tf(v) - lo6) / (hi6 - lo6) * pw6; }, rh6 = 24, H6 = terms.length * rh6 + 26, body6 = '';
      var tk = lg ? [0.25, 0.5, 1, 2, 4, 8].filter(function (v) { return tf(v) >= lo6 - 1e-9 && tf(v) <= hi6 + 1e-9; }) : ticks(lo6, hi6, 5);
      tk.forEach(function (t) { body6 += '<line x1="' + sx6(t) + '" x2="' + sx6(t) + '" y1="4" y2="' + (H6 - 20) + '" class="gl"/>' + txt(sx6(t), H6 - 6, fmt(t), 'middle', 'ct'); });
      body6 += '<line x1="' + sx6(c.ref) + '" x2="' + sx6(c.ref) + '" y1="2" y2="' + (H6 - 20) + '" stroke="' + MUTE + '" stroke-width="1"/>';
      terms.forEach(function (t, i) {
        var y = 6 + i * rh6 + 8;
        body6 += '<g class="mk" tabindex="0"><title>' + esc(t.label + ': ' + fmt(t.value) + ' [' + fmt(t.lo) + ', ' + fmt(t.hi) + ']') + '</title>' + txt(lab6 - 8, y + 4, trunc(t.label, 34), 'end') +
          '<line x1="' + sx6(t.lo) + '" x2="' + sx6(t.hi) + '" y1="' + y + '" y2="' + y + '" stroke="' + MARK + '" stroke-width="2" stroke-linecap="round"/>' +
          '<circle cx="' + sx6(t.value) + '" cy="' + y + '" r="4.5" fill="' + INK + '" stroke="' + SURF + '" stroke-width="2"/></g>';
      });
      return svg(W, H6, body6, lg ? 'Odds ratios with 95% CI' : 'Coefficients with 95% CI');
    }
    if (c.type === 'heat') {
      var n = c.labels.length, get = function (i, j) { return c.cells.filter(function (x) { return (x.i === i && x.j === j) || (x.i === j && x.j === i); })[0]; };
      return '<table class="heat"><thead><tr><th></th>' + c.labels.map(function (l) { return '<th title="' + esc(l) + '">' + esc(trunc(l, 14)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        c.labels.map(function (l, i) { return '<tr><th title="' + esc(l) + '">' + esc(trunc(l, 22)) + '</th>' + c.labels.map(function (_, j) { if (i === j) return '<td class="dg">—</td>'; var x = get(i, j); if (!x) return '<td>–</td>'; var a = Math.min(1, Math.abs(x.v)); return '<td style="background:rgba(75,71,64,' + (a * 0.55).toFixed(2) + ');color:' + (a > 0.5 ? '#fff' : INK) + '">' + x.v.toFixed(2) + (x.sig ? '*' : '') + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
    }
    return '';
  }
  TA.chart = chart;

  // ---------- Views ----------
  TA.workView = function (st) {
    if (st.tab === 'data') return dataView(st);
    if (st.tab === 'analysis') return analysisView(st);
    if (st.tab === 'report') return reportView(st);
    return '';
  };

  function dataView(st) {
    var h = '<div class="work"><div class="wwrap">';
    if (st.upload && st.upload.parsed) return h + mappingView(st) + '</div></div>';
    if (!st.data) {
      h += '<div class="whead"><h2>Data</h2><p class="mute">Generate sample data for a demo, or upload your responses as a CSV.</p></div>' +
        '<div class="srcgrid"><section class="src"><div class="srch">' + ic('spark') + '<b>Generate sample data</b></div>' +
        '<p class="mute">Synthetic answers to this plan\'s questions, ' + sizeOf(st) + ' respondents, with a few planted effects and the usual problems (missing answers, speeders, duplicates). Not real data.</p>' +
        '<button type="button" class="btn-dark" data-act="wgen">Generate</button></section>' +
        '<section class="src"><div class="srch">' + ic('upload') + '<b>Upload a CSV</b></div>' +
        '<p class="mute">One row per respondent. Tahleel matches the columns to the plan\'s questions; you confirm the matches.</p>' +
        '<div class="row2"><label class="btn-line filebtn">Choose file<input type="file" accept=".csv,text/csv" data-role="w-file" hidden></label>' +
        '<button type="button" class="text-btn" data-act="wdl" data-v="template">' + ic('download') + ' Template</button></div>' +
        (st.upload && st.upload.error ? '<p class="err">' + esc(st.upload.error) + '</p>' : '') + '</section></div>';
      return h + '</div></div>';
    }
    var d = st.data, act = TD.activeRows(d, st.excluded, st.flags).length;
    h += '<div class="whead"><h2>Data</h2><div class="wact">' +
      (d.source === 'synthetic' ? '<button type="button" class="btn-ghost" data-act="wgen" title="Generate again with a new seed">' + ic('refresh') + ' New sample</button>' : '<button type="button" class="btn-ghost" data-act="wgen" title="Replace the upload with synthetic data">' + ic('spark') + ' Use sample data</button>') +
      '<label class="btn-ghost filebtn">' + ic('upload') + ' Upload CSV<input type="file" accept=".csv,text/csv" data-role="w-file" hidden></label>' +
      '<button type="button" class="btn-ghost" data-act="wdl" data-v="csv">' + ic('download') + ' CSV</button>' +
      '<button type="button" class="btn-ghost" data-act="wdl" data-v="dict">' + ic('download') + ' Dictionary</button></div></div>' +
      (d.source === 'synthetic' ? '<div class="banner">' + ic('spark') + ' Synthetic data, seed ' + d.seed + '. It shows how the analysis works, not what respondents think.</div>' : '') +
      '<div class="kpis"><div><span class="k">' + d.rows.length + '</span><span class="kl">responses</span></div><div><span class="k">' + act + '</span><span class="kl">analysed</span></div><div><span class="k">' + d.columns.filter(function (c) { return c.source !== 'derived' && c.source !== 'meta'; }).length + '</span><span class="kl">columns</span></div><div><span class="k">' + d.columns.filter(function (c) { return c.kind === 'scale'; }).length + '</span><span class="kl">scale scores</span></div></div>' +
      '<section class="card"><div class="cardh"><b>Checks</b><span class="mute small">Flagged responses are never deleted. Choose which to leave out of the analysis.</span></div>' +
      (st.flags.length ? st.flags.map(function (f) {
        var on = !!st.excluded[f.id];
        return '<div class="chk"><div class="chkt"><b>' + esc(f.label) + '</b><span class="cnt">' + f.rows.length + '</span>' + (f.recommend === 'exclude' ? '<span class="tag">Suggested: leave out</span>' : '<span class="tag">Review</span>') + '<p class="mute">' + esc(f.detail) + '</p></div>' +
          '<label class="exc"><span>' + (on ? 'Left out' : 'Kept') + '</span><button type="button" class="switch' + (on ? ' on' : '') + '" data-act="wexc" data-v="' + f.id + '" role="switch" aria-checked="' + on + '" aria-label="Leave out: ' + esc(f.label) + '"><span></span></button></label></div>';
      }).join('') : '<p class="mute">No problems found.</p>') + '</section>' +
      tableView(st) +
      '<div class="wnext"><button type="button" class="btn-dark" data-act="wtab" data-v="analysis">Continue to analysis ' + ic('arrowR') + '</button></div>';
    return h + '</div></div>';
  }

  function tableView(st) {
    var d = st.data, cols = d.columns.filter(function (c) { return c.kind !== 'text'; }), start = st.page * 50, rows = d.rows.slice(start, start + 50);
    var drop = {}; st.flags.forEach(function (f) { if (st.excluded[f.id]) f.rows.forEach(function (i) { drop[i] = f.label; }); });
    var cell = function (c, v) { if (v == null || v === '') return '<td class="na">·</td>'; if (typeof v === 'number') return '<td class="n">' + (Math.round(v * 100) / 100) + '</td>'; return '<td>' + esc(String(v).length > 18 ? String(v).slice(0, 17) + '…' : v) + '</td>'; };
    return '<section class="card"><div class="cardh"><b>Responses</b><span class="mute small">Rows ' + (start + 1) + '–' + (start + rows.length) + ' of ' + d.rows.length + '. Left-out rows are greyed.</span><span class="grow"></span>' +
      '<button type="button" class="icon-btn sm" data-act="wpage" data-d="-1"' + (st.page === 0 ? ' disabled' : '') + ' aria-label="Previous rows">' + ic('chevronL') + '</button>' +
      '<button type="button" class="icon-btn sm" data-act="wpage" data-d="1"' + (start + 50 >= d.rows.length ? ' disabled' : '') + ' aria-label="Next rows">' + ic('chevronR') + '</button></div>' +
      '<div class="tscroll"><table class="dtab"><thead><tr>' + cols.map(function (c) { return '<th title="' + esc(c.label + ' · ' + c.kind) + '"><span>' + esc(c.id) + '</span><em>' + esc(c.kind) + '</em></th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r, i) { var ix = start + i; return '<tr' + (drop[ix] ? ' class="out" title="Left out: ' + esc(drop[ix]) + '"' : '') + '>' + cols.map(function (c) { return cell(c, r[c.id]); }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div></section>';
  }

  function mappingView(st) {
    var u = st.upload, dict = u.dict.filter(function (c) { return c.source !== 'derived'; });
    var matched = Object.keys(u.map).filter(function (h) { return u.map[h]; }).length;
    return '<div class="whead"><h2>Match columns</h2><p class="mute">' + esc(u.name) + ': ' + u.parsed.rows.length + ' rows, ' + u.parsed.headers.length + ' columns. ' + matched + ' matched to the plan.</p></div>' +
      '<section class="card"><table class="maptab"><thead><tr><th>Column in your file</th><th>First values</th><th>Plan column</th></tr></thead><tbody>' +
      u.parsed.headers.map(function (hd, i) {
        var sample = u.parsed.rows.slice(0, 3).map(function (r) { return r[i]; }).filter(function (v) { return v !== '' && v != null; }).join(', ');
        return '<tr><td><b>' + esc(hd) + '</b></td><td class="mute">' + esc(sample.slice(0, 50)) + '</td><td><select class="ctl" data-role="w-map" data-h="' + esc(hd) + '"><option value="">Ignore</option>' +
          dict.map(function (c) { return '<option value="' + c.id + '"' + (u.map[hd] === c.id ? ' selected' : '') + '>' + esc(c.id + ' · ' + (c.label.length > 50 ? c.label.slice(0, 49) + '…' : c.label)) + '</option>'; }).join('') + '</select></td></tr>';
      }).join('') + '</tbody></table>' + (u.error ? '<p class="err">' + esc(u.error) + '</p>' : '') +
      '<div class="wnext"><button type="button" class="btn-line" data-act="wcancel">Cancel</button><button type="button" class="btn-dark" data-act="wuse">Use this data</button></div></section>';
  }

  function paramControl(st, t, pd) {
    var v = t.params[pd.key], attrs = 'data-tid="' + t.id + '" data-key="' + pd.key + '"';
    if (pd.type === 'choice') return '<label class="pc"><span>' + esc(pd.label) + '</span><select class="ctl" data-role="w-param" ' + attrs + '>' + pd.options.map(function (o) { return '<option value="' + o + '"' + (o === (v || 'auto') ? ' selected' : '') + '>' + (o === 'auto' ? 'Auto (by the checks)' : esc(TESTNAME[o] || o)) + '</option>'; }).join('') + '</select></label>';
    if (pd.type === 'number') return '<label class="pc"><span>' + esc(pd.label) + '</span><input class="ctl num" type="number" step="any" data-role="w-param" ' + attrs + ' value="' + esc(v == null ? '' : v) + '" placeholder="Scale midpoint"></label>';
    var opts = TP.options(st.data.columns, pd), nameOf = function (c) { return c.kind === 'scale' ? c.construct + ' (scale)' : c.kind === 'multi' ? c.label : (c.source === 'question' ? c.id + ' · ' + c.label : c.label); };
    if (pd.type === 'columns') return '<div class="pc wide"><span>' + esc(pd.label) + '</span><div class="chips">' + opts.map(function (c) { var on = (v || []).indexOf(c.id) > -1; return '<button type="button" class="chip' + (on ? ' on' : '') + '" aria-pressed="' + on + '" data-act="wcol" ' + attrs + ' data-v="' + c.id + '" title="' + esc(c.label) + '">' + esc(trunc(nameOf(c), 32)) + '</button>'; }).join('') + '</div></div>';
    return '<label class="pc"><span>' + esc(pd.label) + '</span><select class="ctl" data-role="w-param" ' + attrs + '>' + (pd.optional ? '<option value="">–</option>' : '') + opts.map(function (c) { return '<option value="' + c.id + '"' + (c.id === v ? ' selected' : '') + '>' + esc(trunc(nameOf(c), 60)) + '</option>'; }).join('') + '</select></label>';
  }
  var TESTNAME = { student: 'Student t-test', welch: 'Welch t-test', mannwhitney: 'Mann-Whitney U', anova: 'One-way ANOVA', kruskal: 'Kruskal-Wallis', paired_t: 'Paired t-test', wilcoxon: 'Wilcoxon signed-rank', one_t: 'One-sample t-test', pearson: 'Pearson r', spearman: 'Spearman rho' };

  function resultView(r) {
    if (!r) return '';
    if (!r.ok) return '<div class="res bad">' + esc(r.error) + '</div>';
    var li = function (c) { return '<li class="v-' + c.verdict + '" title="' + esc(c.note || '') + '"><i></i><b>' + esc(c.name) + '</b> ' + esc(c.value || '') + (c.note ? '<span class="mute"> · ' + esc(c.note) + '</span>' : '') + '</li>'; };
    var norm = (r.checks || []).filter(function (c) { return /^Normality, /.test(c.name); }), other = (r.checks || []).filter(function (c) { return !/^Normality, /.test(c.name); });
    var chk;
    if (norm.length > 2) {
      var cnt = { pass: 0, warn: 0, fail: 0 }; norm.forEach(function (c) { cnt[c.verdict]++; });
      var worst = cnt.fail ? 'fail' : cnt.warn ? 'warn' : 'pass', failed = norm.filter(function (c) { return c.verdict === 'fail'; }).map(function (c) { return c.name.replace(/^Normality, /, ''); });
      chk = '<li class="v-' + worst + '"><i></i><b>Normality</b> ' + cnt.pass + ' of ' + norm.length + ' groups pass' + (cnt.warn ? ', ' + cnt.warn + ' mildly skewed with n ≥ 30' : '') + (cnt.fail ? ', ' + cnt.fail + ' not normal (' + esc(failed.join(', ')) + ')' : '') +
        ' <details class="cdet"><summary>Each group</summary><ul class="checks">' + norm.map(li).join('') + '</ul></details></li>' + other.map(li).join('');
    } else chk = (r.checks || []).map(li).join('');
    var stats = (r.stats || []).map(function (s) { return '<span><em>' + esc(s[0]) + '</em> ' + esc(s[1]) + '</span>'; }).join('');
    var eff = r.effect ? '<span><em>' + esc(r.effect.name) + '</em> ' + TP.f2(r.effect.value) + (r.effect.ci ? ' [' + TP.f2(r.effect.ci[0]) + ', ' + TP.f2(r.effect.ci[1]) + ']' : '') + (r.effect.size ? ' · ' + r.effect.size : '') + '</span>' : '';
    var holm = r.pHolm != null ? '<span class="holm"><em>Holm p</em> ' + TP.fp(r.pHolm) + '</span>' : '';
    var sig = r.pHolm != null ? (r.pHolm < 0.05 ? '<span class="pill sig">Clear result</span>' : '<span class="pill">No clear result</span>') : '';
    var tbl = r.table ? '<details class="tdet"><summary>Table</summary><div class="tscroll"><table class="rtab"><thead><tr>' + r.table.head.map(function (x) { return '<th>' + esc(x) + '</th>'; }).join('') + '</tr></thead><tbody>' + r.table.rows.map(function (row) { return '<tr>' + row.map(function (x) { return '<td>' + esc(x) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' +
      (r.post && r.post.rows.length ? '<p class="small mute">' + esc(r.postName || 'Pairwise comparisons') + '</p><table class="rtab"><thead><tr>' + r.post.head.map(function (x) { return '<th>' + esc(x) + '</th>'; }).join('') + '</tr></thead><tbody>' + r.post.rows.map(function (row) { return '<tr>' + row.map(function (x) { return '<td>' + esc(x) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>' : '') + '</details>' : '';
    return '<div class="res">' +
      (r.test ? '<div class="rtest"><b>' + esc(r.test.name) + '</b>' + sig + '<span class="mute"> ' + esc(r.test.reason) + '</span></div>' : '') +
      (r.override ? '<div class="warnline">' + ic('flag') + ' Test set by hand (' + esc(r.override.chosen) + '). The checks point to ' + esc(r.override.rule) + '.</div>' : '') +
      (chk ? '<ul class="checks">' + chk + '</ul>' : '') +
      (stats || eff || holm ? '<div class="stats">' + stats + eff + holm + '</div>' : '') +
      '<p class="rsum">' + esc(r.summary || '') + '</p>' +
      '<div class="cwrap">' + chart(r.chart) + '</div>' + tbl +
      ((r.notes || []).length ? '<p class="small mute">' + esc(r.notes.join(' ')) + '</p>' : '') + '</div>';
  }

  function analysisView(st) {
    var ctx = ctxOf(st), pool = TP.list(), groups = {};
    pool.forEach(function (m) { (groups[m.group] = groups[m.group] || []).push(m); });
    var picker = '<select class="ctl addsel" data-role="w-add" aria-label="Add an analysis"><option value="">Add an analysis…</option>' + Object.keys(groups).map(function (g) { return '<optgroup label="' + g + '">' + groups[g].map(function (m) { return '<option value="' + m.id + '">' + esc(m.label) + '</option>'; }).join('') + '</optgroup>'; }).join('') + '</select>';
    var busy = st.busy === 'analysis';
    var h = '<div class="work"><div class="wwrap"><div class="whead"><h2>Analysis</h2><div class="wact">' +
      '<button type="button" class="btn-dark" data-act="wplan"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Planning ' + DOTS : ic('spark') + ' Plan with Tahleel') + '</button>' + picker + '</div></div>' +
      '<p class="mute small">' + ctx.rows.length + ' responses analysed. Tahleel picks analyses from a tested pool of ' + pool.length + ' modules and never writes code. Each analysis checks its assumptions and chooses the test itself. Edits rerun at once.</p>' +
      (st.workNote ? '<p class="note">' + esc(st.workNote) + '</p>' : '');
    var fam = st.tasks.filter(function (t) { var r = st.results[t.id]; return r && r.ok && r.pHolm != null; }).length;
    if (fam) h += '<p class="small mute">Holm correction applied across ' + fam + ' confirmatory tests.</p>';
    h += st.tasks.map(function (t, i) {
      var m = TP.get(t.module), modSel = '<select class="ctl modsel" data-role="w-module" data-tid="' + t.id + '" aria-label="Module">' + pool.map(function (x) { return '<option value="' + x.id + '"' + (x.id === t.module ? ' selected' : '') + '>' + esc(x.label) + '</option>'; }).join('') + '</select>';
      var open = t.open != null ? t.open : t.source !== 'auto', r0 = st.results[t.id];
      var tog = '<button type="button" class="icon-btn sm tog' + (open ? ' on' : '') + '" data-act="wopen" data-tid="' + t.id + '" aria-expanded="' + open + '" aria-label="' + (open ? 'Collapse' : 'Expand') + '">' + ic('chevronR') + '</button>';
      if (!open) return '<section class="task tmini" id="task-' + t.id + '"><div class="taskh">' + tog + '<span class="qn">' + (i + 1) + '</span><b class="tmin">' + esc(t.title) + '</b><span class="src-' + t.source + '">' + (t.source === 'agent' ? 'Tahleel' : t.source === 'auto' ? 'Standard' : 'Added') + '</span></div>' +
        '<p class="minisum">' + esc(r0 ? (r0.ok ? r0.summary : r0.error) : '') + '</p></section>';
      return '<section class="task rise" id="task-' + t.id + '"><div class="taskh">' + tog + '<span class="qn">' + (i + 1) + '</span><input class="ttitle" data-role="w-title" data-tid="' + t.id + '" value="' + esc(t.title) + '" aria-label="Research question">' +
        '<span class="src-' + t.source + '">' + (t.source === 'agent' ? 'Tahleel' : t.source === 'auto' ? 'Standard' : 'Added') + '</span>' +
        '<button type="button" class="icon-btn sm" data-act="wmove" data-tid="' + t.id + '" data-d="-1" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>' + ic('arrowUp') + '</button>' +
        '<button type="button" class="icon-btn sm" data-act="wdel" data-tid="' + t.id + '" aria-label="Remove analysis" title="Remove">' + ic('trash') + '</button></div>' +
        (t.why ? '<p class="why mute small">' + esc(t.why) + '</p>' : '') +
        '<div class="params">' + modSel + m.params.map(function (pd) { return paramControl(st, t, pd); }).join('') + '</div>' +
        resultView(st.results[t.id]) + '</section>';
    }).join('');
    if (!st.tasks.length) h += '<p class="mute">No analyses yet. Ask Tahleel to plan them, or add one from the pool.</p>';
    h += '<div class="wnext"><button type="button" class="btn-dark" data-act="wtab" data-v="report"' + (st.tasks.length ? '' : ' disabled') + '>Continue to report ' + ic('arrowR') + '</button></div>';
    return h + '</div></div>';
  }

  function reportView(st) {
    var rep = st.report || templateReport(st), ctx = ctxOf(st), busy = st.busy === 'report';
    var ordered = st.tasks.filter(function (t) { var r = st.results[t.id]; return r && r.ok && r.confirmatory; }).concat(st.tasks.filter(function (t) { var r = st.results[t.id]; return r && r.ok && !r.confirmatory; }));
    var findings = ordered.map(function (t, i) {
      var r = st.results[t.id]; if (!r || !r.ok) return '';
      return '<article class="finding"><h4><span class="qn">' + (i + 1) + '</span>' + esc(t.title) + '</h4>' +
        '<textarea class="ctl story" rows="1" data-role="w-report" data-field="story" data-tid="' + t.id + '" aria-label="Finding ' + (i + 1) + '">' + esc(rep.stories[t.id] || r.summary) + '</textarea>' +
        (r.apa ? '<p class="apa">' + esc(r.test ? r.test.name + ': ' : '') + esc(r.apa) + (r.pHolm != null ? ', Holm p ' + esc(TP.fp(r.pHolm)) : '') + '</p>' : '') +
        '<div class="cwrap">' + chart(r.chart) + '</div></article>';
    }).join('');
    return '<div class="work"><div class="wwrap report"><div class="whead"><h2>Report</h2><div class="wact">' +
      '<button type="button" class="btn-dark" data-act="wwrite"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Writing ' + DOTS : ic('spark') + (rep.story ? ' Rewrite with Tahleel' : ' Write the story with Tahleel')) + '</button>' +
      '<button type="button" class="btn-ghost" data-act="wdl" data-v="md">' + ic('download') + ' Report (.md)</button>' +
      '<button type="button" class="btn-ghost" data-act="wdl" data-v="results">' + ic('download') + ' Results (.json)</button>' +
      '<button type="button" class="btn-ghost" data-act="wdl" data-v="csv">' + ic('download') + ' Data (.csv)</button></div></div>' +
      (st.data.source === 'synthetic' ? '<div class="banner">' + ic('spark') + ' Synthetic data. Use this report to see the method, not as findings.</div>' : '') +
      (rep.note ? '<p class="note">' + esc(rep.note) + '</p>' : '') +
      '<p class="small mute">Every number comes from the computed results. Tahleel writes the words only, and any number it writes is checked against the results. Edit any text.</p>' +
      '<section class="rsec"><h3>Summary</h3><textarea class="ctl story" rows="1" data-role="w-report" data-field="summary" aria-label="Summary">' + esc(rep.summary || '') + '</textarea></section>' +
      '<section class="rsec"><h3>Data and checks</h3><p>' + esc(dataText(st, ctx)) + '</p></section>' +
      '<section class="rsec"><h3>Methods</h3><p>' + esc(methodsText(st)) + '</p></section>' +
      '<section class="rsec"><h3>Findings</h3>' + findings + '</section>' +
      '<section class="rsec"><h3>Limitations</h3><textarea class="ctl story" rows="1" data-role="w-report" data-field="limitations" aria-label="Limitations">' + esc(rep.limitations || '') + '</textarea></section>' +
      '</div></div>';
  }

  // ---------- Events (called from app-main.js) ----------
  TA.workClick = function (a, d) {
    var W = TA.work;
    switch (a) {
      case 'wtab': W.tab(d.v); return true;
      case 'wgen': W.generate(); return true;
      case 'wexc': W.exclude(d.v); return true;
      case 'wpage': W.page(Number(d.d)); return true;
      case 'wuse': W.useUpload(); return true;
      case 'wcancel': W.cancelUpload(); return true;
      case 'wdel': W.removeTask(d.tid); return true;
      case 'wmove': W.moveTask(d.tid, Number(d.d)); return true;
      case 'wcol': W.setParam(d.tid, d.key, d.v); return true;
      case 'wplan': W.plan(); return true;
      case 'wopen': W.toggle(d.tid); return true;
      case 'wwrite': W.write(); return true;
      case 'wdl': W.download(d.v); return false;
    }
    return false;
  };
  // Returns true when the change needs a re-render.
  TA.workInput = function (type, t) {
    var d = t.dataset, W = TA.work;
    if (d.role === 'w-title') { W.setTitle(d.tid, t.value); return false; }
    if (d.role === 'w-report') { W.setReport(d.field, d.tid, t.value); return false; }
    if (type !== 'change') return false;
    if (d.role === 'w-param') { W.setParam(d.tid, d.key, t.type === 'number' ? (t.value === '' ? '' : Number(t.value)) : t.value); return true; }
    if (d.role === 'w-module') { W.setModule(d.tid, t.value); return true; }
    if (d.role === 'w-add') { if (t.value) W.addTask(t.value); return true; }
    if (d.role === 'w-map') { W.setMap(d.h, t.value); return true; }
    if (d.role === 'w-file') {
      var f = t.files && t.files[0]; if (!f) return false;
      if (f.size > 20 * 1024 * 1024) { S().upload = { name: f.name, error: 'The file is larger than 20 MB.' }; return true; }
      var fr = new FileReader();
      fr.onload = function () { W.upload(f.name, String(fr.result)); TA.render(); };
      fr.readAsText(f);
      return false;
    }
    return false;
  };
})();
