/* Tahleel analysis module pool. Groq chooses modules and their variables; it never writes code.
   Each module checks its assumptions and picks the test from the decision table below. Runs in the browser and in Node.

   Decision table
   - Two groups: normal in both (Shapiro-Wilk p >= .05, or n >= 30 with |skew| < 1) -> Levene p >= .05 ? Student t : Welch t; otherwise Mann-Whitney U.
     A single Likert item is ordinal -> Mann-Whitney U.
   - Three or more groups: normal in all -> Levene p >= .05 ? one-way ANOVA (pairwise t, Holm) : Welch ANOVA (pairwise Welch t, Holm);
     otherwise Kruskal-Wallis (Dunn, Holm).
   - Two categorical variables: 2x2 with any expected count < 5 -> Fisher's exact; otherwise chi-square (warn if > 20% of expected counts < 5).
   - Two numeric variables: both normal and neither a single Likert item -> Pearson r; otherwise Spearman rho.
   - Paired and one-sample: differences normal -> t-test; otherwise Wilcoxon signed-rank.
   - Regression: OLS; Breusch-Pagan p < .05 -> robust (HC3) errors. Binary outcome -> logistic regression. */
(function (root) {
  'use strict';
  var TS = root.TS || (typeof require !== 'undefined' ? require('./stats.js') : null);
  var NUM = ['likert', 'numeric', 'scale', 'duration'];
  var CAT = ['categorical', 'binary'];

  // ---------- Formatting ----------
  function r2(v) { return Math.round(v * 100) / 100; }
  function r3(v) { return Math.round(v * 1000) / 1000; }
  function f2(v) { return v == null || !isFinite(v) ? '–' : (Math.abs(v) < 0.005 && v !== 0 ? v.toFixed(3) : v.toFixed(2)); }
  function fdf(v) { return Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(2); }
  function fp(p) { if (p == null || !isFinite(p)) return '–'; if (p < 0.001) return '< .001'; return p.toFixed(3).replace(/^0/, ''); }
  function fpEq(p) { return p < 0.001 ? 'p < .001' : 'p = ' + fp(p); }
  function pct(v) { return Math.round(v * 1000) / 10; }
  function sizeLabel(kind, v) {
    var a = Math.abs(v), cuts = { d: [0.2, 0.5, 0.8], r: [0.1, 0.3, 0.5], eta: [0.01, 0.06, 0.14], v: [0.1, 0.3, 0.5] }[kind];
    if (!cuts || !isFinite(a)) return '';
    return a < cuts[0] ? 'negligible' : a < cuts[1] ? 'small' : a < cuts[2] ? 'medium' : 'large';
  }

  // ---------- Data access ----------
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function colOf(ctx, id) { return ctx.dict.filter(function (c) { return c.id === id; })[0]; }
  function label(ctx, id) { var c = colOf(ctx, id); return c ? (c.kind === 'scale' ? c.construct : shortLabel(c)) : id; }
  function shortLabel(c) { var t = c.label || c.id; return c.source === 'question' ? c.id + ' ' + (t.length > 60 ? t.slice(0, 57) + '…' : t) : t; }
  function groupWord(ctx, id) { var c = colOf(ctx, id); return c && c.source === 'demo' ? c.label.toLowerCase() : label(ctx, id); }
  function isSingleItem(c) { return c && c.kind === 'likert'; }
  function levelsOf(ctx, id) {
    var c = colOf(ctx, id), seen = {};
    ctx.rows.forEach(function (r) { var v = r[id]; if (v != null && v !== '') seen[v] = (seen[v] || 0) + 1; });
    var order = c && c.levels ? c.levels.slice() : [];
    if (c && c.kind === 'binary') order = [0, 1];
    var keys = Object.keys(seen).map(function (k) { return c && (c.kind === 'binary') ? Number(k) : k; });
    keys.sort(function (a, b) { var ia = order.indexOf(a), ib = order.indexOf(b); if (ia < 0 && ib < 0) return seen[b] - seen[a]; if (ia < 0) return 1; if (ib < 0) return -1; return ia - ib; });
    return keys.map(function (k) { return { value: k, n: seen[k], label: c && c.kind === 'binary' ? c.levels[k] : String(k) }; });
  }
  function grouped(ctx, groupId, valueId, minN) {
    var lv = levelsOf(ctx, groupId), out = [], dropped = [];
    lv.forEach(function (l) {
      var vals = ctx.rows.filter(function (r) { return r[groupId] === l.value; }).map(function (r) { return num(r[valueId]); }).filter(function (v) { return v !== null; });
      if (vals.length >= (minN || 5)) out.push({ label: l.label, values: vals }); else if (vals.length) dropped.push(l.label + ' (n = ' + vals.length + ')');
    });
    return { groups: out, dropped: dropped };
  }
  function pairs(ctx, a, b) {
    var x = [], y = [];
    ctx.rows.forEach(function (r) { var u = num(r[a]), v = num(r[b]); if (u !== null && v !== null) { x.push(u); y.push(v); } });
    return { x: x, y: y };
  }

  // ---------- Assumption checks ----------
  function normalCheck(vals, name) {
    var n = vals.length, sk = TS.skewness(vals);
    if (n < 3) return { name: 'Normality, ' + name, verdict: 'warn', note: 'Too few values to test.', ok: false };
    var sw = TS.shapiroWilk(vals);
    if (sw.constant) return { name: 'Normality, ' + name, verdict: 'fail', note: 'All values are the same.', ok: false };
    var txt = 'Shapiro-Wilk W = ' + f2(sw.W) + ', ' + fpEq(sw.p) + (isFinite(sk) ? ', skew = ' + f2(sk) : '');
    if (sw.p >= 0.05) return { name: 'Normality, ' + name, value: txt, verdict: 'pass', ok: true, p: sw.p };
    if (n >= 30 && Math.abs(sk) < 1) return { name: 'Normality, ' + name, value: txt, verdict: 'warn', note: 'Not normal by the test, but n ≥ 30 and skew is mild, so the mean-based test is robust.', ok: true, p: sw.p };
    return { name: 'Normality, ' + name, value: txt, verdict: 'fail', ok: false, p: sw.p };
  }
  function leveneCheck(groups) {
    var lv = TS.levene(groups.map(function (g) { return g.values; }));
    return { name: 'Equal variances', value: 'Levene F(' + lv.df1 + ', ' + lv.df2 + ') = ' + f2(lv.F) + ', ' + fpEq(lv.p), verdict: lv.p >= 0.05 ? 'pass' : 'fail', ok: lv.p >= 0.05, p: lv.p };
  }
  function boxOf(lbl, v) { return { label: lbl, n: v.length, min: Math.min.apply(null, v), q1: TS.quantile(v, 0.25), med: TS.median(v), q3: TS.quantile(v, 0.75), max: Math.max.apply(null, v), mean: TS.mean(v) }; }
  function fail(msg) { return { ok: false, error: msg }; }
  function override(res, params, rule, names) {
    if (params.test && params.test !== 'auto' && params.test !== rule) res.override = { chosen: names[params.test] || params.test, rule: names[rule] || rule };
    return params.test && params.test !== 'auto' ? params.test : rule;
  }

  // ---------- Modules ----------
  var M = {};

  M.describe = {
    group: 'Describe', label: 'Describe a variable', purpose: 'Counts and percentages for categories or Likert items; mean, SD, median and spread for numbers and scale scores.',
    params: [{ key: 'column', label: 'Variable', type: 'column', accepts: NUM.concat(CAT) }],
    run: function (ctx, p) {
      var c = colOf(ctx, p.column); if (!c) return fail('Unknown variable.');
      var all = ctx.rows.map(function (r) { return r[p.column]; }), missing = all.filter(function (v) { return v == null || v === ''; }).length;
      if (c.kind === 'categorical' || c.kind === 'binary' || c.kind === 'likert') {
        var lv = levelsOf(ctx, p.column), n = lv.reduce(function (s, l) { return s + l.n; }, 0);
        if (!n) return fail('No answers for this variable.');
        if (c.kind === 'likert') lv = c.levels.map(function (l, i) { var hit = lv.filter(function (x) { return Number(x.value) === i + 1; })[0]; return { value: i + 1, label: l, n: hit ? hit.n : 0 }; });
        var rows = lv.map(function (l) { var ci = TS.wilson(l.n, n); return [l.label, l.n, pct(l.n / n) + '%', pct(ci[0]) + '–' + pct(ci[1]) + '%']; });
        var res = { ok: true, n: n, table: { head: ['Answer', 'n', '%', '95% CI'], rows: rows }, notes: missing ? [missing + ' missing'] : [],
          chart: { type: 'bar', unit: '%', bars: lv.map(function (l) { return { label: l.label, value: pct(l.n / n) }; }) } };
        var top = lv.slice().sort(function (a, b) { return b.n - a.n; })[0];
        res.summary = label(ctx, p.column) + ': the most common answer was "' + top.label + '" (' + pct(top.n / n) + '%, n = ' + n + ').';
        if (c.kind === 'likert') {
          var v = ctx.rows.map(function (r) { return num(r[p.column]); }).filter(function (x) { return x !== null; });
          res.stats = [['Mean', f2(TS.mean(v))], ['SD', f2(TS.sd(v))], ['Median', f2(TS.median(v))]];
          res.summary = label(ctx, p.column) + ': mean ' + f2(TS.mean(v)) + ' (SD ' + f2(TS.sd(v)) + ') on a 1–' + c.levels.length + ' scale, n = ' + n + '.';
        }
        return res;
      }
      var vals = all.map(num).filter(function (x) { return x !== null; });
      if (vals.length < 2) return fail('Not enough values.');
      var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), bins = Math.min(12, Math.max(5, Math.round(Math.sqrt(vals.length)))), w = (hi - lo) / bins || 1, h = [];
      for (var b = 0; b < bins; b++) h.push({ x0: lo + b * w, x1: lo + (b + 1) * w, count: 0 });
      vals.forEach(function (v) { var k = Math.min(bins - 1, Math.floor((v - lo) / w)); h[k].count++; });
      return { ok: true, n: vals.length, notes: missing ? [missing + ' missing'] : [],
        stats: [['Mean', f2(TS.mean(vals))], ['SD', f2(TS.sd(vals))], ['Median', f2(TS.median(vals))], ['IQR', f2(TS.quantile(vals, 0.25)) + '–' + f2(TS.quantile(vals, 0.75))], ['Range', f2(lo) + '–' + f2(hi)], ['Skew', f2(TS.skewness(vals))]],
        chart: { type: 'hist', bins: h, xLabel: label(ctx, p.column) },
        summary: label(ctx, p.column) + ': mean ' + f2(TS.mean(vals)) + ' (SD ' + f2(TS.sd(vals)) + '), median ' + f2(TS.median(vals)) + ', n = ' + vals.length + '.' };
    }
  };

  M.multi_response = {
    group: 'Describe', label: 'Multiple-choice summary', purpose: 'Share of respondents selecting each option of a multiple-choice question.',
    params: [{ key: 'question', label: 'Question', type: 'multi' }],
    run: function (ctx, p) {
      var cols = ctx.dict.filter(function (c) { return c.group === p.question; });
      if (!cols.length) return fail('Unknown multiple-choice question.');
      var answered = ctx.rows.filter(function (r) { return cols.some(function (c) { return r[c.id] != null; }); }), n = answered.length;
      if (!n) return fail('No answers.');
      var bars = cols.map(function (c) { var k = answered.filter(function (r) { return r[c.id] === 1; }).length, ci = TS.wilson(k, n); return { label: c.option, value: pct(k / n), k: k, lo: pct(ci[0]), hi: pct(ci[1]) }; }).sort(function (a, b) { return b.value - a.value; });
      return { ok: true, n: n, table: { head: ['Option', 'n', '%', '95% CI'], rows: bars.map(function (b) { return [b.label, b.k, b.value + '%', b.lo + '–' + b.hi + '%']; }) },
        chart: { type: 'bar', unit: '%', bars: bars }, notes: ['Respondents could choose more than one option, so totals exceed 100%.'],
        summary: 'The most selected option was "' + bars[0].label + '" (' + bars[0].value + '% of ' + n + ' respondents).' };
    }
  };

  M.describe_by_group = {
    group: 'Describe', label: 'Summary by group', purpose: 'Mean, SD and median of a numeric or scale variable for each group, without a test.',
    params: [{ key: 'outcome', label: 'Variable', type: 'column', accepts: NUM }, { key: 'group', label: 'Group by', type: 'column', accepts: CAT }],
    run: function (ctx, p) {
      var g = grouped(ctx, p.group, p.outcome, 1).groups;
      if (!g.length) return fail('No data for these variables.');
      return { ok: true, n: g.reduce(function (s, x) { return s + x.values.length; }, 0),
        table: { head: [label(ctx, p.group), 'n', 'Mean', 'SD', 'Median'], rows: g.map(function (x) { return [x.label, x.values.length, f2(TS.mean(x.values)), f2(TS.sd(x.values)), f2(TS.median(x.values))]; }) },
        chart: { type: 'box', groups: g.map(function (x) { return boxOf(x.label, x.values); }), xLabel: label(ctx, p.outcome) },
        summary: label(ctx, p.outcome) + ' by ' + groupWord(ctx, p.group) + ': group means range from ' + f2(Math.min.apply(null, g.map(function (x) { return TS.mean(x.values); }))) + ' to ' + f2(Math.max.apply(null, g.map(function (x) { return TS.mean(x.values); }))) + '.' };
    }
  };

  M.reliability = {
    group: 'Reliability', label: 'Scale reliability', purpose: "Cronbach's alpha with 95% CI, item-total correlations and alpha if an item is removed, for a scale with 2 or more items.",
    params: [{ key: 'scale', label: 'Scale', type: 'scale' }],
    run: function (ctx, p) {
      var sc = colOf(ctx, p.scale);
      if (!sc || !sc.items || sc.items.length < 2) return fail('Reliability needs a scale with at least two items.');
      var complete = ctx.rows.filter(function (r) { return sc.items.every(function (id) { return num(r[id]) !== null; }); });
      if (complete.length < 10) return fail('Too few complete responses for reliability.');
      var items = sc.items.map(function (id) { return complete.map(function (r) { return r[id]; }); });
      var a = TS.cronbach(items);
      var verdict = a.alpha >= 0.7 ? 'pass' : a.alpha >= 0.6 ? 'warn' : 'fail';
      var weak = a.items.map(function (it, j) { return { id: sc.items[j], gain: it.alphaIfDeleted - a.alpha }; }).filter(function (x) { return x.gain > 0.02; });
      return { ok: true, n: a.n, test: { name: "Cronbach's alpha", reason: 'Internal consistency of the ' + sc.items.length + ' items in this scale.' },
        checks: [{ name: 'Reliability', value: 'α = ' + f2(a.alpha) + ' [' + f2(a.ci[0]) + ', ' + f2(a.ci[1]) + ']', verdict: verdict, note: verdict === 'pass' ? 'Acceptable (≥ .70).' : verdict === 'warn' ? 'Questionable (.60–.70).' : 'Low (< .60): interpret the scale score with care.' }],
        stats: [['Items', a.k], ['Complete cases', a.n]],
        effect: { name: 'α', value: r3(a.alpha), ci: [r3(a.ci[0]), r3(a.ci[1])] },
        table: { head: ['Item', 'Item-total r', 'Alpha if removed', 'Mean', 'SD'], rows: a.items.map(function (it, j) { return [label(ctx, sc.items[j]), f2(it.itemTotal), f2(it.alphaIfDeleted), f2(it.mean), f2(it.sd)]; }) },
        chart: { type: 'bar', unit: '', bars: a.items.map(function (it, j) { return { label: sc.items[j], value: r2(it.itemTotal) }; }), xLabel: 'Item-total correlation' },
        notes: weak.length ? ['Removing ' + weak.map(function (w) { return w.id; }).join(', ') + ' would raise alpha.'] : [],
        summary: sc.construct + ' scale: Cronbach\'s α = ' + f2(a.alpha) + ' (95% CI ' + f2(a.ci[0]) + ' to ' + f2(a.ci[1]) + ', ' + a.k + ' items, n = ' + a.n + ').' };
    }
  };

  M.normality = {
    group: 'Assumptions', label: 'Normality check', purpose: 'Shapiro-Wilk test, skewness and kurtosis for one numeric or scale variable.',
    params: [{ key: 'column', label: 'Variable', type: 'column', accepts: NUM }],
    run: function (ctx, p) {
      var v = ctx.rows.map(function (r) { return num(r[p.column]); }).filter(function (x) { return x !== null; });
      if (v.length < 3) return fail('Not enough values.');
      var chk = normalCheck(v, label(ctx, p.column));
      return { ok: true, n: v.length, test: { name: 'Shapiro-Wilk', reason: 'Checks whether the distribution is close to normal.' }, checks: [chk],
        stats: [['Skew', f2(TS.skewness(v))], ['Excess kurtosis', f2(TS.kurtosis(v))]],
        chart: M.describe.run(ctx, { column: p.column }).chart,
        summary: label(ctx, p.column) + ' is ' + (chk.verdict === 'pass' ? 'close to normal' : chk.verdict === 'warn' ? 'not normal by the test but only mildly skewed' : 'not normally distributed') + ' (' + chk.value + ').' };
    }
  };

  var TWO = { student: 'Student t-test', welch: 'Welch t-test', mannwhitney: 'Mann-Whitney U' };
  M.compare_two = {
    group: 'Compare', label: 'Compare two groups', purpose: 'Difference in a numeric, Likert or scale variable between two groups. Picks Student t, Welch t or Mann-Whitney from the checks.', confirmatory: true,
    params: [{ key: 'outcome', label: 'Outcome', type: 'column', accepts: NUM }, { key: 'group', label: 'Groups', type: 'column', accepts: CAT }, { key: 'test', label: 'Test', type: 'choice', options: ['auto', 'student', 'welch', 'mannwhitney'], optional: true }],
    run: function (ctx, p) {
      var gg = grouped(ctx, p.group, p.outcome, 5), g = gg.groups, notes = gg.dropped.length ? ['Left out (fewer than 5): ' + gg.dropped.join(', ') + '.'] : [];
      if (g.length > 2) { g = g.slice().sort(function (a, b) { return b.values.length - a.values.length; }).slice(0, 2); notes.push('Compared the two largest groups. Use "Compare three or more groups" for all of them.'); }
      if (g.length < 2) return fail('Need two groups with at least 5 answers each.');
      var a = g[0].values, b = g[1].values, oc = colOf(ctx, p.outcome), checks = [], rule, reason;
      var na = normalCheck(a, g[0].label), nb = normalCheck(b, g[1].label);
      checks.push(na, nb);
      if (isSingleItem(oc)) { rule = 'mannwhitney'; reason = 'A single Likert item is ordinal, so groups are compared on ranks.'; }
      else if (na.ok && nb.ok) {
        var lv = leveneCheck(g); checks.push(lv);
        rule = lv.ok ? 'student' : 'welch';
        reason = lv.ok ? 'Both groups are close to normal and variances are similar.' : 'Both groups are close to normal but variances differ.';
      } else { rule = 'mannwhitney'; reason = 'At least one group is not normal, so groups are compared on ranks.'; }
      var res = { ok: true, checks: checks, notes: notes, n: a.length + b.length };
      var use = override(res, p, rule, TWO);
      var table = { head: [label(ctx, p.group), 'n', 'Mean', 'SD', 'Median'], rows: g.map(function (x) { return [x.label, x.values.length, f2(TS.mean(x.values)), f2(TS.sd(x.values)), f2(TS.median(x.values))]; }) };
      res.table = table;
      res.chart = { type: 'box', groups: g.map(function (x) { return boxOf(x.label, x.values); }), xLabel: label(ctx, p.outcome) };
      if (use === 'mannwhitney') {
        var u = TS.mannWhitney(a, b);
        res.test = { name: TWO.mannwhitney, reason: reason };
        res.p = u.p; res.stats = [['U', f2(u.U)], ['z', f2(u.z)], ['p', fp(u.p)]];
        res.effect = { name: 'rank-biserial r', value: r3(u.rbc), size: sizeLabel('r', u.rbc) };
        res.apa = 'U = ' + f2(u.U) + ', z = ' + f2(u.z) + ', ' + fpEq(u.p) + ', r = ' + f2(u.rbc);
      } else {
        var t = TS.tTestInd(a, b, use === 'student');
        res.test = { name: TWO[use], reason: reason };
        res.p = t.p; res.stats = [['t', f2(t.t)], ['df', fdf(t.df)], ['p', fp(t.p)], ['Mean difference', f2(t.diff) + ' [' + f2(t.ci[0]) + ', ' + f2(t.ci[1]) + ']']];
        res.effect = { name: 'Hedges g', value: r3(t.g), ci: [r3(t.gCi[0]), r3(t.gCi[1])], size: sizeLabel('d', t.g) };
        res.apa = 't(' + fdf(t.df) + ') = ' + f2(t.t) + ', ' + fpEq(t.p) + ', g = ' + f2(t.g) + ' [' + f2(t.gCi[0]) + ', ' + f2(t.gCi[1]) + ']';
      }
      var hi = TS.mean(a) >= TS.mean(b) ? g[0] : g[1], lo = hi === g[0] ? g[1] : g[0];
      res.summary = label(ctx, p.outcome) + ' was ' + (res.p < 0.05 ? 'higher' : 'not clearly different') + (res.p < 0.05 ? ' for ' + hi.label + ' than ' + lo.label : ' between ' + g[0].label + ' and ' + g[1].label) + ' (' + res.test.name + ', ' + res.apa + ').';
      return res;
    }
  };

  var MANY = { anova: 'One-way ANOVA', welch: "Welch's ANOVA", kruskal: 'Kruskal-Wallis' };
  M.compare_groups = {
    group: 'Compare', label: 'Compare three or more groups', purpose: 'Difference in a numeric, Likert or scale variable across 3+ groups, with Holm-adjusted pairwise follow-ups. Picks ANOVA, Welch ANOVA or Kruskal-Wallis.', confirmatory: true,
    params: [{ key: 'outcome', label: 'Outcome', type: 'column', accepts: NUM }, { key: 'group', label: 'Groups', type: 'column', accepts: CAT }, { key: 'test', label: 'Test', type: 'choice', options: ['auto', 'anova', 'welch', 'kruskal'], optional: true }],
    run: function (ctx, p) {
      var gg = grouped(ctx, p.group, p.outcome, 5), g = gg.groups, notes = gg.dropped.length ? ['Left out (fewer than 5): ' + gg.dropped.join(', ') + '.'] : [];
      if (g.length === 2) { var two = M.compare_two.run(ctx, { outcome: p.outcome, group: p.group }); if (two.ok) two.notes = notes.concat(['Only two groups had enough answers, so a two-group test was used.'], two.notes || []); return two; }
      if (g.length < 2) return fail('Need at least three groups with 5 or more answers each.');
      var oc = colOf(ctx, p.outcome), checks = g.map(function (x) { return normalCheck(x.values, x.label); }), rule, reason;
      var allNormal = checks.every(function (c) { return c.ok; });
      if (isSingleItem(oc)) { rule = 'kruskal'; reason = 'A single Likert item is ordinal, so groups are compared on ranks.'; }
      else if (allNormal) {
        var lv = leveneCheck(g); checks.push(lv);
        rule = lv.ok ? 'anova' : 'welch'; reason = lv.ok ? 'All groups are close to normal and variances are similar.' : 'All groups are close to normal but variances differ.';
      } else { rule = 'kruskal'; reason = 'At least one group is not normal, so groups are compared on ranks.'; }
      var res = { ok: true, checks: checks, notes: notes, n: g.reduce(function (s, x) { return s + x.values.length; }, 0) };
      var use = override(res, p, rule, MANY), arrs = g.map(function (x) { return x.values; }), labels = g.map(function (x) { return x.label; }), post;
      if (use === 'kruskal') {
        var k = TS.kruskal(arrs);
        res.test = { name: MANY.kruskal, reason: reason }; res.p = k.p;
        res.stats = [['H', f2(k.H)], ['df', k.df], ['p', fp(k.p)]];
        res.effect = { name: 'ε²', value: r3(k.eps2), size: sizeLabel('eta', k.eps2) };
        res.apa = 'H(' + k.df + ') = ' + f2(k.H) + ', ' + fpEq(k.p) + ', ε² = ' + f2(k.eps2);
        post = TS.pairwise(arrs, labels, 'dunn'); res.postName = 'Dunn tests, Holm-adjusted';
      } else if (use === 'welch') {
        var w = TS.welchAnova(arrs);
        res.test = { name: MANY.welch, reason: reason }; res.p = w.p;
        res.stats = [['F', f2(w.F)], ['df', w.df1 + ', ' + fdf(w.df2)], ['p', fp(w.p)]];
        res.effect = { name: 'ω²', value: r3(w.omega2), size: sizeLabel('eta', w.omega2) };
        res.apa = 'F(' + w.df1 + ', ' + fdf(w.df2) + ') = ' + f2(w.F) + ', ' + fpEq(w.p) + ', ω² = ' + f2(w.omega2);
        post = TS.pairwise(arrs, labels, 'welch'); res.postName = 'Welch t-tests, Holm-adjusted';
      } else {
        var an = TS.anovaOneWay(arrs);
        res.test = { name: MANY.anova, reason: reason }; res.p = an.p;
        res.stats = [['F', f2(an.F)], ['df', an.df1 + ', ' + an.df2], ['p', fp(an.p)]];
        res.effect = { name: 'η²', value: r3(an.eta2), size: sizeLabel('eta', an.eta2) };
        res.apa = 'F(' + an.df1 + ', ' + an.df2 + ') = ' + f2(an.F) + ', ' + fpEq(an.p) + ', η² = ' + f2(an.eta2);
        post = TS.pairwise(arrs, labels, 'pooled'); res.postName = 'Pairwise t-tests (pooled SD), Holm-adjusted';
      }
      res.table = { head: [label(ctx, p.group), 'n', 'Mean', 'SD', 'Median'], rows: g.map(function (x) { return [x.label, x.values.length, f2(TS.mean(x.values)), f2(TS.sd(x.values)), f2(TS.median(x.values))]; }) };
      if (res.p < 0.05) res.post = { head: ['Comparison', 'Statistic', 'Holm p'], rows: post.filter(function (q) { return q.pHolm < 0.05; }).map(function (q) { return [q.a + ' vs ' + q.b, f2(q.stat), fp(q.pHolm)]; }) };
      res.chart = { type: 'box', groups: g.map(function (x) { return boxOf(x.label, x.values); }), xLabel: label(ctx, p.outcome) };
      var means = g.map(function (x) { return { l: x.label, m: TS.mean(x.values) }; }).sort(function (a, b) { return b.m - a.m; });
      res.summary = label(ctx, p.outcome) + (res.p < 0.05 ? ' differed across ' : ' did not clearly differ across ') + groupWord(ctx, p.group) + ' groups (' + res.test.name + ', ' + res.apa + ')' + (res.p < 0.05 ? '; highest in ' + means[0].l + ' (mean ' + f2(means[0].m) + '), lowest in ' + means[means.length - 1].l + ' (mean ' + f2(means[means.length - 1].m) + ').' : '.');
      return res;
    }
  };

  M.paired = {
    group: 'Compare', label: 'Compare two measures (paired)', purpose: 'Difference between two numeric or Likert measures from the same respondents (for example pre and post). Paired t or Wilcoxon signed-rank.', confirmatory: true,
    params: [{ key: 'a', label: 'First measure', type: 'column', accepts: NUM }, { key: 'b', label: 'Second measure', type: 'column', accepts: NUM }, { key: 'test', label: 'Test', type: 'choice', options: ['auto', 'paired_t', 'wilcoxon'], optional: true }],
    run: function (ctx, p) {
      var pr = pairs(ctx, p.a, p.b); if (pr.x.length < 5) return fail('Need at least 5 complete pairs.');
      var d = pr.x.map(function (v, i) { return v - pr.y[i]; }), chk = normalCheck(d, 'differences'), single = isSingleItem(colOf(ctx, p.a)) || isSingleItem(colOf(ctx, p.b));
      var rule = !single && chk.ok ? 'paired_t' : 'wilcoxon', reason = single ? 'Single Likert items are ordinal, so the signed-rank test is used.' : chk.ok ? 'The differences are close to normal.' : 'The differences are not normal.';
      var res = { ok: true, checks: [chk], n: d.length }, use = override(res, p, rule, { paired_t: 'Paired t-test', wilcoxon: 'Wilcoxon signed-rank' });
      if (use === 'paired_t') {
        var t = TS.pairedT(pr.x, pr.y);
        res.test = { name: 'Paired t-test', reason: reason }; res.p = t.p;
        res.stats = [['t', f2(t.t)], ['df', t.df], ['p', fp(t.p)], ['Mean difference', f2(t.diff) + ' [' + f2(t.ci[0]) + ', ' + f2(t.ci[1]) + ']']];
        res.effect = { name: 'Cohen d (paired)', value: r3(t.d), size: sizeLabel('d', t.d) };
        res.apa = 't(' + t.df + ') = ' + f2(t.t) + ', ' + fpEq(t.p) + ', d = ' + f2(t.d);
      } else {
        var w = TS.wilcoxon(d);
        res.test = { name: 'Wilcoxon signed-rank', reason: reason }; res.p = w.p;
        res.stats = [['W', f2(w.W)], ['z', f2(w.z)], ['p', fp(w.p)]];
        res.effect = { name: 'rank-biserial r', value: r3(w.rbc), size: sizeLabel('r', w.rbc) };
        res.apa = 'W = ' + f2(w.W) + ', z = ' + f2(w.z) + ', ' + fpEq(w.p) + ', r = ' + f2(w.rbc);
      }
      res.chart = { type: 'box', groups: [boxOf(label(ctx, p.a), pr.x), boxOf(label(ctx, p.b), pr.y)] };
      res.summary = 'Comparing ' + label(ctx, p.a) + ' with ' + label(ctx, p.b) + ': ' + (res.p < 0.05 ? 'a clear difference' : 'no clear difference') + ' (' + res.test.name + ', ' + res.apa + ').';
      return res;
    }
  };

  M.one_sample = {
    group: 'Compare', label: 'Compare with a reference value', purpose: 'Whether the mean or median of a numeric, Likert or scale variable differs from a reference value (default: the scale midpoint).', confirmatory: true,
    params: [{ key: 'column', label: 'Variable', type: 'column', accepts: NUM }, { key: 'value', label: 'Reference value', type: 'number', optional: true }, { key: 'test', label: 'Test', type: 'choice', options: ['auto', 'one_t', 'wilcoxon'], optional: true }],
    run: function (ctx, p) {
      var c = colOf(ctx, p.column), v = ctx.rows.map(function (r) { return num(r[p.column]); }).filter(function (x) { return x !== null; });
      if (v.length < 5) return fail('Need at least 5 values.');
      var ref = p.value != null && p.value !== '' && isFinite(Number(p.value)) ? Number(p.value) : null;
      if (ref === null) {
        if (c.kind === 'likert') ref = (c.levels.length + 1) / 2;
        else if (c.kind === 'scale') { var it = colOf(ctx, c.items[0]); ref = it && it.levels ? (it.levels.length + 1) / 2 : (it && it.max === 10 ? 5 : TS.median(v)); }
        else return fail('Set a reference value for this variable.');
      }
      var chk = normalCheck(v, label(ctx, p.column)), single = isSingleItem(c);
      var rule = !single && chk.ok ? 'one_t' : 'wilcoxon', reason = single ? 'A single Likert item is ordinal, so the signed-rank test is used.' : chk.ok ? 'The distribution is close to normal.' : 'The distribution is not normal.';
      var res = { ok: true, checks: [chk], n: v.length }, use = override(res, p, rule, { one_t: 'One-sample t-test', wilcoxon: 'Wilcoxon signed-rank' });
      if (use === 'one_t') {
        var t = TS.oneSampleT(v, ref);
        res.test = { name: 'One-sample t-test', reason: reason + ' Reference value: ' + ref + '.' }; res.p = t.p;
        res.stats = [['Mean', f2(TS.mean(v))], ['t', f2(t.t)], ['df', t.df], ['p', fp(t.p)], ['Difference', f2(t.diff) + ' [' + f2(t.ci[0]) + ', ' + f2(t.ci[1]) + ']']];
        res.effect = { name: 'Cohen d', value: r3(t.d), size: sizeLabel('d', t.d) };
        res.apa = 't(' + t.df + ') = ' + f2(t.t) + ', ' + fpEq(t.p) + ', d = ' + f2(t.d);
      } else {
        var w = TS.wilcoxon(v.map(function (x) { return x - ref; }));
        res.test = { name: 'Wilcoxon signed-rank', reason: reason + ' Reference value: ' + ref + '.' }; res.p = w.p;
        res.stats = [['Median', f2(TS.median(v))], ['W', f2(w.W)], ['z', f2(w.z)], ['p', fp(w.p)]];
        res.effect = { name: 'rank-biserial r', value: r3(w.rbc), size: sizeLabel('r', w.rbc) };
        res.apa = 'W = ' + f2(w.W) + ', z = ' + f2(w.z) + ', ' + fpEq(w.p) + ', r = ' + f2(w.rbc);
      }
      res.chart = M.describe.run(ctx, { column: p.column }).chart;
      res.summary = label(ctx, p.column) + ' (mean ' + f2(TS.mean(v)) + ') was ' + (res.p < 0.05 ? (TS.mean(v) > ref ? 'above' : 'below') : 'not clearly different from') + ' the reference value of ' + ref + ' (' + res.test.name + ', ' + res.apa + ').';
      return res;
    }
  };

  M.crosstab = {
    group: 'Associate', label: 'Two categorical variables', purpose: 'Association between two categorical variables (or yes/no, multiple-choice options). Chi-square, or Fisher exact for small 2x2 tables, with Cramér V.', confirmatory: true,
    params: [{ key: 'row', label: 'Rows', type: 'column', accepts: CAT }, { key: 'col', label: 'Columns', type: 'column', accepts: CAT }],
    run: function (ctx, p) {
      var rl = levelsOf(ctx, p.row), cl = levelsOf(ctx, p.col);
      var rows = ctx.rows.filter(function (r) { return r[p.row] != null && r[p.row] !== '' && r[p.col] != null && r[p.col] !== ''; });
      if (rows.length < 10) return fail('Too few responses with both answers.');
      // Keep levels with at least one count, cap at 12 levels each (others merged).
      var cap = function (lv) { return lv.length > 12 ? lv.slice(0, 11).concat([{ value: '__other', label: 'Other', n: 0 }]) : lv; };
      rl = cap(rl.slice().sort(function (a, b) { return b.n - a.n; })); cl = cap(cl);
      var key = function (lv, v) { var i = lv.map(function (l) { return l.value; }).indexOf(v); return i > -1 ? i : lv.length - 1; };
      var tab = rl.map(function () { return cl.map(function () { return 0; }); });
      rows.forEach(function (r) { tab[key(rl, r[p.row])][key(cl, r[p.col])]++; });
      var keepR = tab.map(function (r) { return TS.sum(r) > 0; }), keepC = cl.map(function (_, j) { return TS.sum(tab.map(function (r) { return r[j]; })) > 0; });
      tab = tab.filter(function (_, i) { return keepR[i]; }).map(function (r) { return r.filter(function (_, j) { return keepC[j]; }); });
      rl = rl.filter(function (_, i) { return keepR[i]; }); cl = cl.filter(function (_, j) { return keepC[j]; });
      if (tab.length < 2 || tab[0].length < 2) return fail('Each variable needs at least two answered categories.');
      var ch = TS.chiSquare(tab), cells = tab.length * tab[0].length, checks = [], res = { ok: true, n: ch.n };
      var is2 = tab.length === 2 && tab[0].length === 2;
      var expOk = ch.minExpected >= 5;
      checks.push({ name: 'Expected counts', value: 'Smallest expected count = ' + f2(ch.minExpected) + (ch.lowCells ? ', ' + ch.lowCells + ' of ' + cells + ' cells below 5' : ''), verdict: expOk ? 'pass' : (is2 || ch.lowCells / cells > 0.2 ? 'fail' : 'warn'), ok: expOk });
      if (is2 && !expOk) {
        var fx = TS.fisherExact(tab);
        res.test = { name: "Fisher's exact test", reason: 'A 2×2 table with an expected count below 5.' }; res.p = fx.p;
        res.stats = [['Odds ratio', f2(fx.oddsRatio)], ['p', fp(fx.p)]];
        res.effect = { name: 'odds ratio', value: r3(fx.oddsRatio) };
        res.apa = 'Fisher exact ' + fpEq(fx.p) + ', OR = ' + f2(fx.oddsRatio);
      } else {
        res.test = { name: 'Chi-square test', reason: expOk ? 'All expected counts are 5 or more.' : 'Some expected counts are below 5; read the result with care or merge categories.' };
        res.p = ch.p; res.stats = [['χ²', f2(ch.chi2)], ['df', ch.df], ['p', fp(ch.p)], ["Cramér's V", f2(ch.cramerV)]];
        res.effect = { name: "Cramér's V", value: r3(ch.cramerV), size: sizeLabel('v', ch.cramerV) };
        res.apa = 'χ²(' + ch.df + ', N = ' + ch.n + ') = ' + f2(ch.chi2) + ', ' + fpEq(ch.p) + ', V = ' + f2(ch.cramerV);
      }
      res.checks = checks;
      res.table = { head: [label(ctx, p.row) + ' \\ ' + label(ctx, p.col)].concat(cl.map(function (c) { return c.label; })).concat(['Total']),
        rows: tab.map(function (r, i) { var t = TS.sum(r); return [rl[i].label].concat(r.map(function (v) { return v + ' (' + Math.round(v / t * 100) + '%)'; })).concat([t]); }) };
      res.chart = { type: 'stacked', legend: cl.map(function (c) { return c.label; }), rows: tab.map(function (r, i) { var t = TS.sum(r); return { label: rl[i].label, parts: r.map(function (v) { return pct(v / t); }) }; }) };
      res.summary = label(ctx, p.row) + ' and ' + label(ctx, p.col) + ' were ' + (res.p < 0.05 ? 'associated' : 'not clearly associated') + ' (' + res.test.name + ', ' + res.apa + ').';
      return res;
    }
  };

  M.correlate = {
    group: 'Associate', label: 'Relationship between two variables', purpose: 'Correlation between two numeric, Likert or scale variables. Pearson r when both are close to normal, otherwise Spearman rho, with 95% CI.', confirmatory: true,
    params: [{ key: 'x', label: 'Variable 1', type: 'column', accepts: NUM }, { key: 'y', label: 'Variable 2', type: 'column', accepts: NUM }, { key: 'test', label: 'Test', type: 'choice', options: ['auto', 'pearson', 'spearman'], optional: true }],
    run: function (ctx, p) {
      var pr = pairs(ctx, p.x, p.y); if (pr.x.length < 10) return fail('Need at least 10 complete pairs.');
      var cx = normalCheck(pr.x, label(ctx, p.x)), cy = normalCheck(pr.y, label(ctx, p.y)), single = isSingleItem(colOf(ctx, p.x)) || isSingleItem(colOf(ctx, p.y));
      var rule = !single && cx.ok && cy.ok ? 'pearson' : 'spearman';
      var reason = single ? 'At least one variable is a single Likert item (ordinal).' : rule === 'pearson' ? 'Both variables are close to normal.' : 'At least one variable is not normal.';
      var res = { ok: true, checks: [cx, cy], n: pr.x.length }, use = override(res, p, rule, { pearson: 'Pearson r', spearman: 'Spearman rho' });
      var r = use === 'pearson' ? TS.pearson(pr.x, pr.y) : TS.spearman(pr.x, pr.y), val = use === 'pearson' ? r.r : r.rho, sym = use === 'pearson' ? 'r' : 'ρ';
      res.test = { name: use === 'pearson' ? 'Pearson correlation' : 'Spearman correlation', reason: reason }; res.p = r.p;
      res.stats = [[sym, f2(val)], ['95% CI', f2(r.ci[0]) + ', ' + f2(r.ci[1])], ['p', fp(r.p)], ['n', r.n]];
      res.effect = { name: sym, value: r3(val), ci: [r3(r.ci[0]), r3(r.ci[1])], size: sizeLabel('r', val) };
      res.apa = sym + '(' + (r.n - 2) + ') = ' + f2(val) + ' [' + f2(r.ci[0]) + ', ' + f2(r.ci[1]) + '], ' + fpEq(r.p);
      var step = Math.max(1, Math.ceil(pr.x.length / 400)), pts = [];
      for (var i = 0; i < pr.x.length; i += step) pts.push([pr.x[i], pr.y[i]]);
      var mx = TS.mean(pr.x), my = TS.mean(pr.y), sxy = 0, sxx = 0; pr.x.forEach(function (v, k) { sxy += (v - mx) * (pr.y[k] - my); sxx += (v - mx) * (v - mx); });
      var slope = sxy / sxx;
      res.chart = { type: 'scatter', points: pts, line: [my - slope * mx, slope], xLabel: label(ctx, p.x), yLabel: label(ctx, p.y), jitter: single };
      res.summary = label(ctx, p.x) + ' and ' + label(ctx, p.y) + ' showed ' + (res.p < 0.05 ? (sizeLabel('r', val) + ' ' + (val > 0 ? 'positive' : 'negative') + ' relationship') : 'no clear relationship') + ' (' + res.test.name + ', ' + res.apa + ').';
      return res;
    }
  };

  M.correlation_matrix = {
    group: 'Associate', label: 'Correlations among several variables', purpose: 'Spearman correlations among 3 to 8 scale scores or numeric variables, Holm-adjusted. Exploratory.',
    params: [{ key: 'columns', label: 'Variables', type: 'columns', accepts: NUM }],
    run: function (ctx, p) {
      var ids = (p.columns || []).filter(function (id) { return colOf(ctx, id); }).slice(0, 8);
      if (ids.length < 2) return fail('Choose at least two variables.');
      var cells = [], ps = [];
      for (var i = 0; i < ids.length; i++) for (var j = i + 1; j < ids.length; j++) {
        var pr = pairs(ctx, ids[i], ids[j]); if (pr.x.length < 10) continue;
        var r = TS.spearman(pr.x, pr.y); cells.push({ i: i, j: j, rho: r.rho, p: r.p, n: r.n }); ps.push(r.p);
      }
      TS.holm(ps).forEach(function (q, k) { cells[k].pHolm = q; });
      var get = function (i, j) { return cells.filter(function (c) { return (c.i === i && c.j === j) || (c.i === j && c.j === i); })[0]; };
      return { ok: true, n: ctx.rows.length, test: { name: 'Spearman correlation matrix', reason: 'Rank-based, so it does not assume normality. p values are Holm-adjusted across the matrix.' },
        table: { head: [''].concat(ids.map(function (id) { return label(ctx, id); })), rows: ids.map(function (a, i) { return [label(ctx, a)].concat(ids.map(function (b, j) { if (i === j) return '—'; var c = get(i, j); return c ? f2(c.rho) + (c.pHolm < 0.05 ? '*' : '') : '–'; })); }) },
        chart: { type: 'heat', labels: ids.map(function (id) { return label(ctx, id); }), cells: cells.map(function (c) { return { i: c.i, j: c.j, v: r2(c.rho), sig: c.pHolm < 0.05 }; }) },
        notes: ['* Holm-adjusted p < .05.'],
        summary: 'Of ' + cells.length + ' correlations, ' + cells.filter(function (c) { return c.pHolm < 0.05; }).length + ' were significant after Holm adjustment.' };
    }
  };

  function design(ctx, outcome, preds, yfn) {
    var ok = ctx.rows.filter(function (r) { return yfn(r[outcome]) !== null && preds.every(function (id) { var v = r[id]; return v != null && v !== '' && (colOf(ctx, id).kind === 'categorical' || num(v) !== null); }); });
    var names = ['(Intercept)'], cols = [], notes = [];
    preds.forEach(function (id) {
      var c = colOf(ctx, id);
      if (c.kind === 'categorical') {
        var lv = levelsOf({ rows: ok, dict: ctx.dict }, id).sort(function (a, b) { return b.n - a.n; });
        var keep = lv.filter(function (l) { return l.n >= 5; });
        if (keep.length < 2) return;
        notes.push(label(ctx, id) + ': reference group is ' + keep[0].label + '.');
        keep.slice(1, 8).forEach(function (l) { names.push(label(ctx, id) + ': ' + l.label); cols.push(function (r) { return r[id] === l.value ? 1 : 0; }); });
      } else { names.push(label(ctx, id)); cols.push(function (r) { return num(r[id]); }); }
    });
    var X = ok.map(function (r) { return [1].concat(cols.map(function (f) { return f(r); })); });
    return { X: X, y: ok.map(function (r) { return yfn(r[outcome]); }), names: names, notes: notes };
  }

  M.linear_regression = {
    group: 'Predict', label: 'Linear regression', purpose: 'Predict a numeric or scale outcome from 1 to 6 predictors (numeric, Likert, scale or categorical). Robust (HC3) errors when variance is unequal.', confirmatory: true,
    params: [{ key: 'outcome', label: 'Outcome', type: 'column', accepts: ['numeric', 'scale', 'likert'] }, { key: 'predictors', label: 'Predictors', type: 'columns', accepts: NUM.concat(CAT) }],
    run: function (ctx, p) {
      var preds = (p.predictors || []).filter(function (id) { return colOf(ctx, id) && id !== p.outcome; }).slice(0, 6);
      if (!preds.length) return fail('Choose at least one predictor.');
      var d = design(ctx, p.outcome, preds, num);
      if (d.y.length < d.names.length * 5 + 5) return fail('Too few complete responses for this many predictors.');
      var m = TS.ols(d.y, d.X, d.names); if (m.error) return fail(m.error);
      var robust = m.bp && m.bp.p < 0.05, maxVif = m.vif.length ? Math.max.apply(null, m.vif) : 1, sw = TS.shapiroWilk(m.resid);
      var checks = [
        { name: 'Equal variance of residuals', value: m.bp ? 'Breusch-Pagan LM = ' + f2(m.bp.lm) + ', ' + fpEq(m.bp.p) : '–', verdict: robust ? 'fail' : 'pass', ok: !robust, note: robust ? 'Unequal variance, so robust (HC3) standard errors are used.' : '' },
        { name: 'Collinearity', value: 'Largest VIF = ' + f2(maxVif), verdict: maxVif < 5 ? 'pass' : maxVif < 10 ? 'warn' : 'fail', ok: maxVif < 10 },
        { name: 'Normality of residuals', value: 'Shapiro-Wilk W = ' + f2(sw.W) + ', ' + fpEq(sw.p), verdict: sw.p >= 0.05 ? 'pass' : (m.n >= 100 ? 'warn' : 'fail'), ok: true, note: sw.p < 0.05 && m.n >= 100 ? 'Large sample: coefficient tests are robust to this.' : '' },
        { name: 'Cases per predictor', value: f2(m.n / (d.names.length - 1)), verdict: m.n / (d.names.length - 1) >= 10 ? 'pass' : 'warn', ok: true }
      ];
      var rows = m.coef.map(function (c) { return [c.name, f2(c.b), f2(robust ? c.seHC3 : c.se), f2(robust ? c.tHC3 : c.t), fp(robust ? c.pHC3 : c.p), f2((robust ? c.ciHC3 : c.ci)[0]) + ', ' + f2((robust ? c.ciHC3 : c.ci)[1])]; });
      var sig = m.coef.slice(1).filter(function (c) { return (robust ? c.pHC3 : c.p) < 0.05; }).map(function (c) { return c.name + ' (b = ' + f2(c.b) + ')'; });
      var f2v = m.r2 / (1 - m.r2);
      return { ok: true, n: m.n, checks: checks, notes: d.notes, p: m.pF,
        test: { name: robust ? 'Linear regression, robust (HC3) errors' : 'Linear regression (OLS)', reason: robust ? 'Residual variance is unequal (Breusch-Pagan), so HC3 errors protect the coefficient tests.' : 'Residual variance is similar across fitted values.' },
        stats: [['R²', f2(m.r2)], ['Adjusted R²', f2(m.adjR2)], ['F', f2(m.F) + ' (' + m.df1 + ', ' + m.df2 + ')'], ['p', fp(m.pF)]],
        effect: { name: 'R²', value: r3(m.r2), size: f2v < 0.02 ? 'negligible' : f2v < 0.15 ? 'small' : f2v < 0.35 ? 'medium' : 'large' },
        apa: 'F(' + m.df1 + ', ' + m.df2 + ') = ' + f2(m.F) + ', ' + fpEq(m.pF) + ', R² = ' + f2(m.r2),
        table: { head: ['Term', 'b', 'SE', 't', 'p', '95% CI'], rows: rows },
        chart: { type: 'coef', ref: 0, terms: m.coef.slice(1).map(function (c) { var ci = robust ? c.ciHC3 : c.ci; return { label: c.name, value: r3(c.b), lo: r3(ci[0]), hi: r3(ci[1]) }; }) },
        summary: 'The model explained ' + pct(m.r2) + '% of the variance in ' + label(ctx, p.outcome) + ' (' + 'F(' + m.df1 + ', ' + m.df2 + ') = ' + f2(m.F) + ', ' + fpEq(m.pF) + ')' + (sig.length ? '; clear predictors: ' + sig.join(', ') + '.' : '; no single predictor was clear.') };
    }
  };

  M.logistic_regression = {
    group: 'Predict', label: 'Logistic regression', purpose: 'Predict a yes/no outcome (or any two-category variable) from 1 to 6 predictors. Reports odds ratios with 95% CI.', confirmatory: true,
    params: [{ key: 'outcome', label: 'Outcome (two categories)', type: 'column', accepts: CAT }, { key: 'predictors', label: 'Predictors', type: 'columns', accepts: NUM.concat(CAT) }],
    run: function (ctx, p) {
      var lv = levelsOf(ctx, p.outcome);
      if (lv.length !== 2) return fail('The outcome needs exactly two categories (it has ' + lv.length + ').');
      var event = lv.filter(function (l) { return /^(yes|selected)$/i.test(l.label) || l.value === 1; })[0] || lv.slice().sort(function (a, b) { return a.n - b.n; })[0];
      var preds = (p.predictors || []).filter(function (id) { return colOf(ctx, id) && id !== p.outcome; }).slice(0, 6);
      if (!preds.length) return fail('Choose at least one predictor.');
      var d = design(ctx, p.outcome, preds, function (v) { return v == null || v === '' ? null : (v === event.value ? 1 : 0); });
      var events = TS.sum(d.y), nonev = d.y.length - events, epv = Math.min(events, nonev) / (d.names.length - 1);
      if (Math.min(events, nonev) < 5) return fail('Too few responses in one outcome category.');
      var m = TS.logistic(d.y, d.X, d.names); if (m.error) return fail(m.error);
      var checks = [
        { name: 'Events per predictor', value: f2(epv), verdict: epv >= 10 ? 'pass' : epv >= 5 ? 'warn' : 'fail', ok: epv >= 5 },
        { name: 'Separation', value: m.separated ? 'Some coefficients are extreme' : 'None', verdict: m.separated ? 'fail' : 'pass', ok: !m.separated }
      ];
      var sig = m.coef.slice(1).filter(function (c) { return c.p < 0.05; }).map(function (c) { return c.name + ' (OR = ' + f2(c.or) + ')'; });
      return { ok: true, n: m.n, checks: checks, notes: d.notes.concat(['Outcome modelled: ' + event.label + ' (' + events + ' of ' + m.n + ').']), p: m.pLR,
        test: { name: 'Logistic regression', reason: 'The outcome has two categories.' },
        stats: [['McFadden R²', f2(m.mcfadden)], ['Likelihood ratio χ²', f2(m.lr) + ' (df ' + m.df + ')'], ['p', fp(m.pLR)]],
        effect: { name: 'McFadden R²', value: r3(m.mcfadden) },
        apa: 'χ²(' + m.df + ') = ' + f2(m.lr) + ', ' + fpEq(m.pLR) + ', McFadden R² = ' + f2(m.mcfadden),
        table: { head: ['Term', 'Odds ratio', '95% CI', 'p'], rows: m.coef.map(function (c) { return [c.name, f2(c.or), f2(c.orCi[0]) + ', ' + f2(c.orCi[1]), fp(c.p)]; }) },
        chart: { type: 'coef', ref: 1, log: true, terms: m.coef.slice(1).map(function (c) { return { label: c.name, value: r3(c.or), lo: r3(c.orCi[0]), hi: r3(c.orCi[1]) }; }) },
        summary: 'The model predicted "' + event.label + '" for ' + label(ctx, p.outcome) + ' (' + 'χ²(' + m.df + ') = ' + f2(m.lr) + ', ' + fpEq(m.pLR) + ')' + (sig.length ? '; clear predictors: ' + sig.join(', ') + '.' : '; no single predictor was clear.') };
    }
  };

  // ---------- Pool API ----------
  var ORDER = ['describe', 'multi_response', 'describe_by_group', 'reliability', 'normality', 'compare_two', 'compare_groups', 'paired', 'one_sample', 'crosstab', 'correlate', 'correlation_matrix', 'linear_regression', 'logistic_regression'];
  function list() { return ORDER.map(function (id) { return Object.assign({ id: id }, M[id]); }); }
  function get(id) { return M[id] ? Object.assign({ id: id }, M[id]) : null; }

  // Columns a parameter accepts, from the data dictionary.
  function options(dict, param) {
    if (param.type === 'scale') return dict.filter(function (c) { return c.kind === 'scale' && c.items && c.items.length >= 2; });
    if (param.type === 'multi') { var seen = {}; return dict.filter(function (c) { if (c.kind !== 'binary' || !c.group || seen[c.group]) return false; seen[c.group] = true; return true; }).map(function (c) { return { id: c.group, label: c.group + ' ' + c.label.split(':')[0], kind: 'multi' }; }); }
    if (param.type === 'column' || param.type === 'columns') return dict.filter(function (c) { return param.accepts.indexOf(c.kind) > -1 && c.kind !== 'id' && !(c.id === 'nationality'); });
    return [];
  }
  // Check a task's parameters against the dictionary. Returns an error message or "".
  function validate(task, dict) {
    var m = M[task.module]; if (!m) return 'Unknown module.';
    for (var i = 0; i < m.params.length; i++) {
      var pd = m.params[i], v = task.params[pd.key];
      if (v == null || v === '' || (Array.isArray(v) && !v.length)) { if (pd.optional) continue; return 'Choose ' + pd.label.toLowerCase() + '.'; }
      if (pd.type === 'choice') { if (pd.options.indexOf(v) < 0) return 'Unknown test option.'; continue; }
      if (pd.type === 'number') { if (!isFinite(Number(v))) return 'Reference value must be a number.'; continue; }
      var ok = options(dict, pd).map(function (c) { return c.id; });
      var vals = Array.isArray(v) ? v : [v];
      for (var j = 0; j < vals.length; j++) if (ok.indexOf(vals[j]) < 0) return '"' + vals[j] + '" cannot be used as ' + pd.label.toLowerCase() + '.';
    }
    return '';
  }
  // Run every task, then Holm-adjust the confirmatory tests together.
  function runAll(tasks, ctx) {
    var out = {};
    tasks.forEach(function (t) {
      var err = validate(t, ctx.dict), res;
      if (err) res = fail(err);
      else { try { res = M[t.module].run(ctx, t.params); } catch (e) { res = fail('This analysis could not run: ' + (e && e.message ? e.message : 'unknown error') + '.'); } }
      res.module = t.module; res.confirmatory = !!M[t.module].confirmatory;
      out[t.id] = res;
    });
    var fam = tasks.filter(function (t) { var r = out[t.id]; return r.ok && r.confirmatory && typeof r.p === 'number'; });
    TS.holm(fam.map(function (t) { return out[t.id].p; })).forEach(function (q, i) { out[fam[i].id].pHolm = q; out[fam[i].id].familySize = fam.length; });
    return out;
  }
  // Compact spec for Groq: what each module does and the parameter types.
  function spec() {
    return ORDER.map(function (id) {
      var m = M[id];
      return { module: id, purpose: m.purpose, params: m.params.map(function (p) { return { key: p.key, type: p.type, accepts: p.accepts, options: p.options, optional: !!p.optional }; }) };
    });
  }

  var TP = { fdf: fdf, list: list, get: get, options: options, validate: validate, runAll: runAll, spec: spec, fp: fp, f2: f2, ORDER: ORDER };
  if (typeof module !== 'undefined' && module.exports) module.exports = TP;
  else root.TP = TP;
})(this);
