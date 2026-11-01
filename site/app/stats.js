/* Tahleel statistics library. Plain JavaScript, no dependencies. Runs in the browser and in Node (for validation).
   Every function here is checked against scipy / statsmodels on fixed datasets (tests/golden). */
(function (root) {
  'use strict';

  // ---------- Special functions ----------
  var LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  function lgamma(x) {
    if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
    x -= 1;
    var a = LANCZOS[0], t = x + 7.5;
    for (var i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }

  // Regularized lower incomplete gamma P(a, x) and upper Q(a, x).
  function gammaP(a, x) {
    if (x <= 0) return 0;
    if (x < a + 1) return gser(a, x);
    return 1 - gcf(a, x);
  }
  function gammaQ(a, x) {
    if (x <= 0) return 1;
    if (x < a + 1) return 1 - gser(a, x);
    return gcf(a, x);
  }
  function gser(a, x) {
    var ap = a, sum = 1 / a, del = sum;
    for (var n = 0; n < 10000; n++) {
      ap += 1; del *= x / ap; sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-16) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
  function gcf(a, x) {
    var FPMIN = 1e-300, b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
    for (var i = 1; i < 10000; i++) {
      var an = -i * (i - a);
      b += 2;
      d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      var del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-16) break;
    }
    return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
  }

  // Regularized incomplete beta I_x(a, b).
  function ibeta(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    var bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(x, a, b) / a;
    return 1 - bt * betacf(1 - x, b, a) / b;
  }
  function betacf(x, a, b) {
    var FPMIN = 1e-300, qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    var h = d;
    for (var m = 1; m <= 10000; m++) {
      var m2 = 2 * m, aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      var del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-16) break;
    }
    return h;
  }

  // ---------- Distributions ----------
  // Normal: upper tail via the incomplete gamma, accurate far into the tails.
  function normSf(z) { return z >= 0 ? 0.5 * gammaQ(0.5, z * z / 2) : 1 - 0.5 * gammaQ(0.5, z * z / 2); }
  function normCdf(z) { return z < 0 ? normSf(-z) : 1 - normSf(z); }
  function normPdf(z) { return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI); }
  // Acklam's inverse normal, refined with one Halley step.
  function normInv(p) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    var q, r, x;
    if (p < 0.02425) {
      q = Math.sqrt(-2 * Math.log(p));
      x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else if (p > 1 - 0.02425) {
      q = Math.sqrt(-2 * Math.log(1 - p));
      x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else {
      q = p - 0.5; r = q * q;
      x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    }
    for (var k = 0; k < 2; k++) {
      var e = normCdf(x) - p, u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
      x = x - u / (1 + x * u / 2);
    }
    return x;
  }
  // Student t: two-sided p, cdf, quantile.
  function tSf2(t, df) { return ibeta(df / (df + t * t), df / 2, 0.5); }
  function tCdf(t, df) { var p = 0.5 * tSf2(t, df); return t > 0 ? 1 - p : p; }
  function tInv(p, df) { return invert(function (x) { return tCdf(x, df); }, p, -1e4, 1e4); }
  // F upper tail and quantile.
  function fSf(f, d1, d2) { return f <= 0 ? 1 : ibeta(d2 / (d2 + d1 * f), d2 / 2, d1 / 2); }
  function fInv(p, d1, d2) { return invert(function (x) { return 1 - fSf(x, d1, d2); }, p, 0, 1e6); }
  // Chi-square upper tail.
  function chi2Sf(x, k) { return x <= 0 ? 1 : gammaQ(k / 2, x / 2); }
  // Bisection on a monotone cdf.
  function invert(cdf, p, lo, hi) {
    for (var i = 0; i < 300; i++) {
      var mid = (lo + hi) / 2;
      if (cdf(mid) < p) lo = mid; else hi = mid;
      if (hi - lo < 1e-14 * Math.max(1, Math.abs(mid))) break;
    }
    return (lo + hi) / 2;
  }

  // ---------- Descriptives ----------
  function clean(a) { return a.filter(function (v) { return typeof v === 'number' && isFinite(v); }); }
  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }
  function mean(a) { return a.length ? sum(a) / a.length : NaN; }
  function variance(a) {
    var n = a.length; if (n < 2) return NaN;
    var m = mean(a), s = 0;
    for (var i = 0; i < n; i++) s += (a[i] - m) * (a[i] - m);
    return s / (n - 1);
  }
  function sd(a) { return Math.sqrt(variance(a)); }
  function sorted(a) { return a.slice().sort(function (x, y) { return x - y; }); }
  // Linear interpolation quantile (numpy default, type 7).
  function quantile(a, q) {
    var s = sorted(a), n = s.length; if (!n) return NaN;
    var h = (n - 1) * q, lo = Math.floor(h), hi = Math.ceil(h);
    return s[lo] + (h - lo) * (s[hi] - s[lo]);
  }
  function median(a) { return quantile(a, 0.5); }
  // Bias-corrected skewness (G1) and excess kurtosis (G2), as scipy with bias=False.
  function skewness(a) {
    var n = a.length; if (n < 3) return NaN;
    var m = mean(a), m2 = 0, m3 = 0;
    for (var i = 0; i < n; i++) { var d = a[i] - m; m2 += d * d; m3 += d * d * d; }
    m2 /= n; m3 /= n;
    if (m2 === 0) return 0;
    var g1 = m3 / Math.pow(m2, 1.5);
    return g1 * Math.sqrt(n * (n - 1)) / (n - 2);
  }
  function kurtosis(a) {
    var n = a.length; if (n < 4) return NaN;
    var m = mean(a), m2 = 0, m4 = 0;
    for (var i = 0; i < n; i++) { var d = a[i] - m; m2 += d * d; m4 += d * d * d * d; }
    m2 /= n; m4 /= n;
    if (m2 === 0) return 0;
    var g2 = m4 / (m2 * m2) - 3;
    return ((n + 1) * g2 + 6) * (n - 1) / ((n - 2) * (n - 3));
  }
  // Average ranks with ties; returns ranks and the tie groups' sizes.
  function rank(a) {
    var idx = a.map(function (v, i) { return [v, i]; }).sort(function (x, y) { return x[0] - y[0]; });
    var r = new Array(a.length), ties = [], i = 0;
    while (i < idx.length) {
      var j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      var avg = (i + j) / 2 + 1;
      for (var k = i; k <= j; k++) r[idx[k][1]] = avg;
      if (j > i) ties.push(j - i + 1);
      i = j + 1;
    }
    return { ranks: r, ties: ties };
  }
  function tieSum(ties) { var s = 0; ties.forEach(function (t) { s += t * t * t - t; }); return s; }

  // Wilson score interval for a proportion.
  function wilson(k, n, conf) {
    if (!n) return [NaN, NaN];
    var z = normInv(1 - (1 - (conf || 0.95)) / 2), p = k / n, z2 = z * z;
    var c = (p + z2 / (2 * n)) / (1 + z2 / n), h = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / (1 + z2 / n);
    return [Math.max(0, c - h), Math.min(1, c + h)];
  }

  // Holm step-down adjustment. Returns adjusted p values in the input order.
  function holm(ps) {
    var m = ps.length, order = ps.map(function (p, i) { return [p, i]; }).sort(function (a, b) { return a[0] - b[0]; });
    var adj = new Array(m), run = 0;
    order.forEach(function (o, k) { run = Math.max(run, Math.min(1, (m - k) * o[0])); adj[o[1]] = run; });
    return adj;
  }

  // ---------- Assumption checks ----------
  // Shapiro-Wilk W and p (Royston 1995, algorithm AS R94, as in R and scipy). n from 3 to 5000.
  function shapiroWilk(xs) {
    var x = sorted(clean(xs)), n = x.length;
    if (n < 3) return { W: NaN, p: NaN, n: n };
    if (n > 5000) x = x.slice(0, 5000), n = 5000;
    var range = x[n - 1] - x[0];
    if (range < 1e-12) return { W: 1, p: 1, n: n, constant: true };
    var nn2 = Math.floor(n / 2), a = new Array(nn2 + 1);
    var poly = function (cc, xv) { var r = 0; for (var i = cc.length - 1; i >= 0; i--) r = r * xv + cc[i]; return r; };
    var c1 = [0, 0.221157, -0.147981, -2.07119, 4.434685, -2.706056];
    var c2 = [0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633];
    if (n === 3) a[1] = Math.SQRT1_2;
    else {
      var an25 = n + 0.25, summ2 = 0, m = new Array(nn2 + 1);
      for (var i = 1; i <= nn2; i++) { m[i] = normInv((i - 0.375) / an25); summ2 += m[i] * m[i]; }
      summ2 *= 2;
      var ssumm2 = Math.sqrt(summ2), rsn = 1 / Math.sqrt(n);
      var a1 = poly(c1, rsn) - m[1] / ssumm2, i1, fac;
      if (n > 5) {
        i1 = 3;
        var a2 = -m[2] / ssumm2 + poly(c2, rsn);
        fac = Math.sqrt((summ2 - 2 * m[1] * m[1] - 2 * m[2] * m[2]) / (1 - 2 * a1 * a1 - 2 * a2 * a2));
        a[2] = a2;
      } else {
        i1 = 2;
        fac = Math.sqrt((summ2 - 2 * m[1] * m[1]) / (1 - 2 * a1 * a1));
      }
      a[1] = a1;
      for (var j = i1; j <= nn2; j++) a[j] = -m[j] / fac;
    }
    // Full antisymmetric coefficient vector, then W as the squared correlation with the sorted data.
    var A = new Array(n).fill(0);
    for (var k = 1; k <= nn2; k++) { A[k - 1] = -a[k]; A[n - k] = a[k]; }
    var xm = mean(x), num = 0, ssa = 0, ssx = 0;
    for (var t = 0; t < n; t++) { num += A[t] * (x[t] - xm); ssa += A[t] * A[t]; ssx += (x[t] - xm) * (x[t] - xm); }
    var W = (num * num) / (ssa * ssx);
    if (W > 1) W = 1;
    var p;
    if (n === 3) {
      p = 6 / Math.PI * (Math.asin(Math.sqrt(W)) - Math.asin(Math.sqrt(0.75)));
      p = Math.max(0, Math.min(1, p));
      return { W: W, p: p, n: n };
    }
    var w1 = Math.log(1 - W), mu, s, y;
    if (n <= 11) {
      var gamma = -2.273 + 0.459 * n;
      if (w1 >= gamma) return { W: W, p: 1e-99, n: n };
      y = -Math.log(gamma - w1);
      mu = poly([0.544, -0.39978, 0.025054, -6.714e-4], n);
      s = Math.exp(poly([1.3822, -0.77857, 0.062767, -0.0020322], n));
    } else {
      var ln = Math.log(n);
      y = w1;
      mu = poly([-1.5861, -0.31082, -0.083751, 0.0038915], ln);
      s = Math.exp(poly([-0.4803, -0.082676, 0.0030302], ln));
    }
    p = normSf((y - mu) / s);
    return { W: W, p: p, n: n };
  }

  // Levene's test, centred on the median (Brown-Forsythe), as scipy's default.
  function levene(groups) {
    var z = groups.map(function (g) { var md = median(g); return g.map(function (v) { return Math.abs(v - md); }); });
    var r = anovaOneWay(z);
    return { F: r.F, df1: r.df1, df2: r.df2, p: r.p };
  }

  // ---------- Two groups ----------
  function tTestInd(a, b, equalVar) {
    var n1 = a.length, n2 = b.length, m1 = mean(a), m2 = mean(b), v1 = variance(a), v2 = variance(b), t, df, se;
    if (equalVar) {
      var sp2 = ((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2);
      se = Math.sqrt(sp2 * (1 / n1 + 1 / n2)); df = n1 + n2 - 2;
    } else {
      se = Math.sqrt(v1 / n1 + v2 / n2);
      df = Math.pow(v1 / n1 + v2 / n2, 2) / (Math.pow(v1 / n1, 2) / (n1 - 1) + Math.pow(v2 / n2, 2) / (n2 - 1));
    }
    t = (m1 - m2) / se;
    var crit = tInv(0.975, df), diff = m1 - m2;
    // Hedges g (pooled SD, small-sample corrected) with an approximate 95% CI.
    var spool = Math.sqrt(((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2));
    var d = diff / spool, J = 1 - 3 / (4 * (n1 + n2) - 9), g = d * J;
    var seg = Math.sqrt((n1 + n2) / (n1 * n2) + g * g / (2 * (n1 + n2)));
    return { t: t, df: df, p: tSf2(t, df), diff: diff, ci: [diff - crit * se, diff + crit * se], g: g, gCi: [g - 1.959963984540054 * seg, g + 1.959963984540054 * seg] };
  }

  // Mann-Whitney U: normal approximation with tie and continuity correction (scipy method="asymptotic").
  function mannWhitney(a, b) {
    var n1 = a.length, n2 = b.length, n = n1 + n2, rk = rank(a.concat(b)), R1 = 0;
    for (var i = 0; i < n1; i++) R1 += rk.ranks[i];
    var U1 = R1 - n1 * (n1 + 1) / 2, U2 = n1 * n2 - U1, U = Math.max(U1, U2);
    var mu = n1 * n2 / 2, s = Math.sqrt(n1 * n2 / 12 * ((n + 1) - tieSum(rk.ties) / (n * (n - 1))));
    var z = (U - mu - 0.5) / s, p = Math.min(1, 2 * normSf(z));
    return { U: U1, z: (U1 - mu) / s, p: p, rbc: 2 * U1 / (n1 * n2) - 1 };
  }

  // ---------- Several groups ----------
  function anovaOneWay(groups) {
    var all = [].concat.apply([], groups), N = all.length, k = groups.length, gm = mean(all), ssb = 0, ssw = 0;
    groups.forEach(function (g) { var m = mean(g); ssb += g.length * (m - gm) * (m - gm); g.forEach(function (v) { ssw += (v - m) * (v - m); }); });
    var df1 = k - 1, df2 = N - k, msw = ssw / df2, F = (ssb / df1) / msw, sst = ssb + ssw;
    return { F: F, df1: df1, df2: df2, p: fSf(F, df1, df2), eta2: ssb / sst, omega2: (ssb - df1 * msw) / (sst + msw), msw: msw };
  }
  // Welch's ANOVA (as statsmodels anova_oneway, use_var="unequal").
  function welchAnova(groups) {
    var k = groups.length, w = [], m = [], n = [], W = 0, N = 0;
    groups.forEach(function (g, i) { n[i] = g.length; m[i] = mean(g); w[i] = n[i] / variance(g); W += w[i]; N += n[i]; });
    var xw = 0; for (var i = 0; i < k; i++) xw += w[i] * m[i]; xw /= W;
    var A = 0, lam = 0;
    for (var j = 0; j < k; j++) { A += w[j] * (m[j] - xw) * (m[j] - xw); lam += Math.pow(1 - w[j] / W, 2) / (n[j] - 1); }
    A /= (k - 1);
    var B = 1 + 2 * (k - 2) / (k * k - 1) * lam, F = A / B, df1 = k - 1, df2 = (k * k - 1) / (3 * lam);
    var om = Math.max(0, df1 * (F - 1) / (df1 * (F - 1) + N));
    return { F: F, df1: df1, df2: df2, p: fSf(F, df1, df2), omega2: om };
  }
  // Kruskal-Wallis H with tie correction.
  function kruskal(groups) {
    var all = [].concat.apply([], groups), N = all.length, rk = rank(all), pos = 0, H = 0;
    groups.forEach(function (g) { var R = 0; for (var i = 0; i < g.length; i++) R += rk.ranks[pos + i]; pos += g.length; H += R * R / g.length; });
    H = 12 / (N * (N + 1)) * H - 3 * (N + 1);
    var C = 1 - tieSum(rk.ties) / (N * N * N - N);
    H /= C;
    var df = groups.length - 1;
    return { H: H, df: df, p: chi2Sf(H, df), eps2: H / (N - 1) };
  }
  // Pairwise follow-ups, Holm-adjusted. kind: "pooled" (after ANOVA), "welch", "dunn".
  function pairwise(groups, labels, kind) {
    var out = [], ps = [];
    var all = kind === 'dunn' ? [].concat.apply([], groups) : null, rk = all ? rank(all) : null, N = all ? all.length : 0;
    var meanRanks = [], pos = 0;
    if (rk) groups.forEach(function (g) { var R = 0; for (var i = 0; i < g.length; i++) R += rk.ranks[pos + i]; pos += g.length; meanRanks.push(R / g.length); });
    var aov = kind === 'pooled' ? anovaOneWay(groups) : null;
    for (var i = 0; i < groups.length; i++) for (var j = i + 1; j < groups.length; j++) {
      var a = groups[i], b = groups[j], stat, p;
      if (kind === 'dunn') {
        var se = Math.sqrt((N * (N + 1) / 12 - tieSum(rk.ties) / (12 * (N - 1))) * (1 / a.length + 1 / b.length));
        stat = (meanRanks[i] - meanRanks[j]) / se; p = 2 * normSf(Math.abs(stat));
      } else if (kind === 'pooled') {
        var se2 = Math.sqrt(aov.msw * (1 / a.length + 1 / b.length));
        stat = (mean(a) - mean(b)) / se2; p = tSf2(stat, aov.df2);
      } else {
        var r = tTestInd(a, b, false); stat = r.t; p = r.p;
      }
      out.push({ a: labels[i], b: labels[j], stat: stat, p: p }); ps.push(p);
    }
    holm(ps).forEach(function (q, i) { out[i].pHolm = q; });
    return out;
  }

  // ---------- Categorical ----------
  function chiSquare(table) {
    var R = table.length, C = table[0].length, rs = [], cs = new Array(C).fill(0), N = 0;
    table.forEach(function (row, i) { rs[i] = sum(row); row.forEach(function (v, j) { cs[j] += v; }); N += rs[i]; });
    var chi2 = 0, exp = [], minE = Infinity, low = 0;
    for (var i = 0; i < R; i++) {
      exp[i] = [];
      for (var j = 0; j < C; j++) {
        var e = rs[i] * cs[j] / N; exp[i][j] = e; minE = Math.min(minE, e); if (e < 5) low++;
        chi2 += (table[i][j] - e) * (table[i][j] - e) / e;
      }
    }
    var df = (R - 1) * (C - 1);
    return { chi2: chi2, df: df, p: chi2Sf(chi2, df), expected: exp, minExpected: minE, lowCells: low, cramerV: Math.sqrt(chi2 / (N * Math.min(R - 1, C - 1))), n: N };
  }
  function lchoose(n, k) { return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1); }
  // Fisher's exact test for 2x2, two-sided (as scipy: sums tables no more likely than the observed one).
  function fisherExact(t) {
    var a = t[0][0], b = t[0][1], c = t[1][0], d = t[1][1], r1 = a + b, c1 = a + c, n = a + b + c + d;
    var lo = Math.max(0, c1 - (n - r1)), hi = Math.min(r1, c1);
    var pr = function (x) { return Math.exp(lchoose(r1, x) + lchoose(n - r1, c1 - x) - lchoose(n, c1)); };
    var pobs = pr(a), p = 0;
    for (var x = lo; x <= hi; x++) { var px = pr(x); if (px <= pobs * (1 + 1e-7)) p += px; }
    var or = (b * c === 0) ? (a * d === 0 ? NaN : Infinity) : (a * d) / (b * c);
    return { p: Math.min(1, p), oddsRatio: or };
  }

  // ---------- Correlation ----------
  function pearson(x, y) {
    var n = x.length, mx = mean(x), my = mean(y), sxy = 0, sxx = 0, syy = 0;
    for (var i = 0; i < n; i++) { var dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    var r = sxy / Math.sqrt(sxx * syy);
    r = Math.max(-1, Math.min(1, r));
    var df = n - 2, t = r * Math.sqrt(df / (1 - r * r));
    var z = 0.5 * Math.log((1 + r) / (1 - r)), se = 1 / Math.sqrt(n - 3);
    return { r: r, t: t, df: df, p: Math.abs(r) === 1 ? 0 : tSf2(t, df), ci: [Math.tanh(z - 1.959963984540054 * se), Math.tanh(z + 1.959963984540054 * se)], n: n };
  }
  function spearman(x, y) {
    var rx = rank(x).ranks, ry = rank(y).ranks, r = pearson(rx, ry), n = x.length;
    var z = 0.5 * Math.log((1 + r.r) / (1 - r.r)), se = Math.sqrt(1.06 / (n - 3));
    return { rho: r.r, t: r.t, df: r.df, p: r.p, ci: [Math.tanh(z - 1.959963984540054 * se), Math.tanh(z + 1.959963984540054 * se)], n: n };
  }

  // ---------- Paired and one-sample ----------
  function pairedT(x, y) {
    var d = x.map(function (v, i) { return v - y[i]; });
    return oneSampleT(d, 0);
  }
  function oneSampleT(x, mu) {
    var n = x.length, m = mean(x), s = sd(x), se = s / Math.sqrt(n), t = (m - mu) / se, df = n - 1, crit = tInv(0.975, df);
    return { t: t, df: df, p: tSf2(t, df), diff: m - mu, ci: [m - mu - crit * se, m - mu + crit * se], d: (m - mu) / s };
  }
  // Wilcoxon signed-rank, normal approximation with tie correction, zeros dropped (scipy method="approx").
  function wilcoxon(d) {
    var nz = d.filter(function (v) { return v !== 0; }), n = nz.length;
    var rk = rank(nz.map(Math.abs)), rp = 0, rm = 0;
    nz.forEach(function (v, i) { if (v > 0) rp += rk.ranks[i]; else rm += rk.ranks[i]; });
    var mn = n * (n + 1) / 4, se = Math.sqrt(n * (n + 1) * (2 * n + 1) / 24 - tieSum(rk.ties) / 48);
    var z = (rp - mn) / se;
    return { W: Math.min(rp, rm), z: z, p: Math.min(1, 2 * normSf(Math.abs(z))), rbc: (rp - rm) / (rp + rm), n: n };
  }

  // ---------- Reliability ----------
  // Cronbach's alpha on complete cases, Feldt 95% CI, corrected item-total r, alpha if item deleted.
  function cronbach(items) {
    var k = items.length, n = items[0].length;
    var alphaOf = function (cols) {
      var kk = cols.length, sv = 0, tot = new Array(n).fill(0);
      cols.forEach(function (c) { sv += variance(c); for (var i = 0; i < n; i++) tot[i] += c[i]; });
      return kk / (kk - 1) * (1 - sv / variance(tot));
    };
    var alpha = alphaOf(items);
    var df1 = n - 1, df2 = (n - 1) * (k - 1);
    var ci = [1 - (1 - alpha) * fInv(0.975, df1, df2), 1 - (1 - alpha) * fInv(0.025, df1, df2)];
    var itemStats = items.map(function (c, j) {
      var rest = new Array(n).fill(0);
      items.forEach(function (o, jj) { if (jj !== j) for (var i = 0; i < n; i++) rest[i] += o[i]; });
      var others = items.filter(function (_, jj) { return jj !== j; });
      return { itemTotal: pearson(c, rest).r, alphaIfDeleted: others.length > 1 ? alphaOf(others) : NaN, mean: mean(c), sd: sd(c) };
    });
    return { alpha: alpha, ci: ci, n: n, k: k, items: itemStats };
  }

  // ---------- Linear algebra ----------
  function transpose(A) { return A[0].map(function (_, j) { return A.map(function (r) { return r[j]; }); }); }
  function matmul(A, B) {
    var n = A.length, m = B[0].length, p = B.length, C = [];
    for (var i = 0; i < n; i++) { C[i] = new Array(m).fill(0); for (var k = 0; k < p; k++) { var a = A[i][k]; if (a) for (var j = 0; j < m; j++) C[i][j] += a * B[k][j]; } }
    return C;
  }
  function inverse(M) {
    var n = M.length, A = M.map(function (r, i) { return r.concat(Array.from({ length: n }, function (_, j) { return i === j ? 1 : 0; })); });
    for (var c = 0; c < n; c++) {
      var piv = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      if (Math.abs(A[piv][c]) < 1e-12) return null;
      var tmp = A[c]; A[c] = A[piv]; A[piv] = tmp;
      var pv = A[c][c];
      for (var j = 0; j < 2 * n; j++) A[c][j] /= pv;
      for (var r2 = 0; r2 < n; r2++) if (r2 !== c) { var f = A[r2][c]; if (f) for (var j2 = 0; j2 < 2 * n; j2++) A[r2][j2] -= f * A[c][j2]; }
    }
    return A.map(function (r) { return r.slice(n); });
  }

  // OLS with intercept already in X. Classical and HC3 standard errors, Breusch-Pagan (Koenker), VIF.
  function ols(y, X, names) {
    var n = y.length, p = X[0].length, Xt = transpose(X), XtXi = inverse(matmul(Xt, X));
    if (!XtXi) return { error: 'Predictors are perfectly collinear.' };
    var beta = matmul(XtXi, matmul(Xt, y.map(function (v) { return [v]; }))).map(function (r) { return r[0]; });
    var fit = X.map(function (r) { var s = 0; for (var j = 0; j < p; j++) s += r[j] * beta[j]; return s; });
    var e = y.map(function (v, i) { return v - fit[i]; }), sse = sum(e.map(function (v) { return v * v; }));
    var my = mean(y), sst = sum(y.map(function (v) { return (v - my) * (v - my); })), df = n - p, s2 = sse / df;
    var h = X.map(function (r) { var v = 0; for (var a = 0; a < p; a++) for (var b = 0; b < p; b++) v += r[a] * XtXi[a][b] * r[b]; return v; });
    // HC3: (X'X)^-1 X' diag(e^2/(1-h)^2) X (X'X)^-1
    var meat = []; for (var a = 0; a < p; a++) { meat[a] = new Array(p).fill(0); }
    for (var i = 0; i < n; i++) { var w = e[i] * e[i] / Math.pow(1 - h[i], 2); for (var a2 = 0; a2 < p; a2++) for (var b2 = 0; b2 < p; b2++) meat[a2][b2] += X[i][a2] * X[i][b2] * w; }
    var hc3 = matmul(matmul(XtXi, meat), XtXi);
    var crit = tInv(0.975, df);
    var coef = beta.map(function (b, j) {
      var se = Math.sqrt(s2 * XtXi[j][j]), seR = Math.sqrt(hc3[j][j]);
      return { name: names[j], b: b, se: se, t: b / se, p: tSf2(b / se, df), ci: [b - crit * se, b + crit * se], seHC3: seR, tHC3: b / seR, pHC3: tSf2(b / seR, df), ciHC3: [b - crit * seR, b + crit * seR] };
    });
    var r2 = 1 - sse / sst, k = p - 1, F = k > 0 ? (r2 / k) / ((1 - r2) / df) : NaN;
    // Breusch-Pagan, studentized (Koenker): n * R^2 of e^2 on X.
    var e2 = e.map(function (v) { return v * v; }), aux = null;
    if (k > 0) { var bAux = matmul(XtXi, matmul(Xt, e2.map(function (v) { return [v]; }))).map(function (r) { return r[0]; });
      var fit2 = X.map(function (r) { var s = 0; for (var j = 0; j < p; j++) s += r[j] * bAux[j]; return s; });
      var me2 = mean(e2), ssr2 = 0, sst2 = 0; for (var q = 0; q < n; q++) { ssr2 += Math.pow(e2[q] - fit2[q], 2); sst2 += Math.pow(e2[q] - me2, 2); }
      var lm = n * (1 - ssr2 / sst2); aux = { lm: lm, df: k, p: chi2Sf(lm, k) }; }
    // VIF for each non-intercept column.
    var vif = [];
    for (var j3 = 1; j3 < p; j3++) {
      if (p < 3) { vif.push(1); continue; }
      var yj = X.map(function (r) { return r[j3]; }), Xj = X.map(function (r) { return r.filter(function (_, c) { return c !== j3; }); });
      var Xjt = transpose(Xj), inv = inverse(matmul(Xjt, Xj));
      if (!inv) { vif.push(Infinity); continue; }
      var bj = matmul(inv, matmul(Xjt, yj.map(function (v) { return [v]; }))).map(function (r) { return r[0]; });
      var myj = mean(yj), sr = 0, st = 0;
      for (var q2 = 0; q2 < n; q2++) { var f2 = 0; for (var c2 = 0; c2 < bj.length; c2++) f2 += Xj[q2][c2] * bj[c2]; sr += Math.pow(yj[q2] - f2, 2); st += Math.pow(yj[q2] - myj, 2); }
      vif.push(1 / (sr / st));
    }
    return { coef: coef, r2: r2, adjR2: 1 - (1 - r2) * (n - 1) / df, F: F, df1: k, df2: df, pF: k > 0 ? fSf(F, k, df) : NaN, n: n, resid: e, bp: aux, vif: vif };
  }

  // Logistic regression by iteratively reweighted least squares. y is 0/1, X includes the intercept.
  function logistic(y, X, names) {
    var n = y.length, p = X[0].length, beta = new Array(p).fill(0), Xt = transpose(X), ll = -Infinity, cov = null, iter;
    for (iter = 0; iter < 100; iter++) {
      var eta = X.map(function (r) { var s = 0; for (var j = 0; j < p; j++) s += r[j] * beta[j]; return s; });
      var mu = eta.map(function (v) { return 1 / (1 + Math.exp(-v)); });
      var W = mu.map(function (m) { return Math.max(m * (1 - m), 1e-10); });
      var XtWX = []; for (var a = 0; a < p; a++) { XtWX[a] = new Array(p).fill(0); }
      var grad = new Array(p).fill(0);
      for (var i = 0; i < n; i++) for (var a2 = 0; a2 < p; a2++) { grad[a2] += X[i][a2] * (y[i] - mu[i]); for (var b = 0; b < p; b++) XtWX[a2][b] += X[i][a2] * W[i] * X[i][b]; }
      cov = inverse(XtWX);
      if (!cov) return { error: 'The model could not be fitted (predictors are collinear or perfectly separate the outcome).' };
      var step = cov.map(function (r) { return sum(r.map(function (v, j) { return v * grad[j]; })); });
      for (var j2 = 0; j2 < p; j2++) beta[j2] += step[j2];
      var newll = 0;
      for (var i2 = 0; i2 < n; i2++) { var s2 = 0; for (var j3 = 0; j3 < p; j3++) s2 += X[i2][j3] * beta[j3]; newll += y[i2] * s2 - Math.log(1 + Math.exp(s2)); }
      if (Math.abs(newll - ll) < 1e-10) { ll = newll; break; }
      ll = newll;
    }
    // Final covariance at the solution.
    var eta2 = X.map(function (r) { var s = 0; for (var j = 0; j < p; j++) s += r[j] * beta[j]; return s; });
    var XtWX2 = []; for (var a3 = 0; a3 < p; a3++) { XtWX2[a3] = new Array(p).fill(0); }
    for (var i3 = 0; i3 < n; i3++) { var m3 = 1 / (1 + Math.exp(-eta2[i3])), w3 = m3 * (1 - m3); for (var a4 = 0; a4 < p; a4++) for (var b4 = 0; b4 < p; b4++) XtWX2[a4][b4] += X[i3][a4] * w3 * X[i3][b4]; }
    cov = inverse(XtWX2);
    if (!cov) return { error: 'The model could not be fitted.' };
    var ybar = mean(y), ll0 = n * (ybar * Math.log(ybar) + (1 - ybar) * Math.log(1 - ybar));
    var coef = beta.map(function (b, j) {
      var se = Math.sqrt(cov[j][j]), z = b / se;
      return { name: names[j], b: b, se: se, z: z, p: 2 * normSf(Math.abs(z)), or: Math.exp(b), orCi: [Math.exp(b - 1.959963984540054 * se), Math.exp(b + 1.959963984540054 * se)] };
    });
    var lr = 2 * (ll - ll0);
    return { coef: coef, ll: ll, ll0: ll0, mcfadden: 1 - ll / ll0, lr: lr, df: p - 1, pLR: chi2Sf(lr, p - 1), n: n, iterations: iter + 1, separated: beta.some(function (b) { return Math.abs(b) > 15; }) };
  }

  var TS = {
    lgamma: lgamma, gammaP: gammaP, gammaQ: gammaQ, ibeta: ibeta,
    normCdf: normCdf, normSf: normSf, normPdf: normPdf, normInv: normInv, tCdf: tCdf, tSf2: tSf2, tInv: tInv, fSf: fSf, fInv: fInv, chi2Sf: chi2Sf,
    clean: clean, sum: sum, mean: mean, variance: variance, sd: sd, median: median, quantile: quantile, skewness: skewness, kurtosis: kurtosis, rank: rank,
    wilson: wilson, holm: holm, shapiroWilk: shapiroWilk, levene: levene,
    tTestInd: tTestInd, mannWhitney: mannWhitney, anovaOneWay: anovaOneWay, welchAnova: welchAnova, kruskal: kruskal, pairwise: pairwise,
    chiSquare: chiSquare, fisherExact: fisherExact, pearson: pearson, spearman: spearman,
    pairedT: pairedT, oneSampleT: oneSampleT, wilcoxon: wilcoxon, cronbach: cronbach, ols: ols, logistic: logistic
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = TS;
  else root.TS = TS;
})(this);
