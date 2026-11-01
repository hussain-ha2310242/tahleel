// Compares Tahleel's JavaScript statistics with the scipy/statsmodels reference values.
// Run: node tests/golden/check.js   (after python3 tests/golden/make_reference.py)
const path = require('path');
const TS = require(path.join(__dirname, '../../site/app/stats.js'));
const { data: D, ref: R } = require(path.join(__dirname, 'reference.json'));
let fails = 0, passes = 0;
function close(got, want, name, tol) {
  tol = tol || 1e-6;
  const ok = (Number.isNaN(want) && Number.isNaN(got)) || Math.abs(got - want) <= tol * Math.max(1, Math.abs(want));
  if (ok) passes++; else { fails++; console.log('FAIL', name, 'got', got, 'want', want); }
}
function closeP(got, want, name) {
  // p values: relative 1e-6, or absolute 1e-12 for tiny ones
  const ok = Math.abs(got - want) <= Math.max(1e-12, 1e-6 * Math.abs(want));
  if (ok) passes++; else { fails++; console.log('FAIL', name, 'got', got, 'want', want); }
}

D.sw.forEach((v, i) => { const r = TS.shapiroWilk(v); close(r.W, R.shapiro[i][0], 'shapiro W n=' + v.length, 1e-5); closeP(r.p, R.shapiro[i][1], 'shapiro p n=' + v.length); });
[[D.e, 10], [D.lik1, 11]].forEach(([v, i]) => { const r = TS.shapiroWilk(v); close(r.W, R.shapiro[i][0], 'shapiro W #' + i, 1e-5); close(r.p, R.shapiro[i][1], 'shapiro p #' + i, 1e-4); });

let r = TS.levene([D.c, D.d]); close(r.F, R.levene[0], 'levene F'); closeP(r.p, R.levene[1], 'levene p');
r = TS.levene([D.h1, D.h2, D.h3]); close(r.F, R.levene[2], 'levene3 F'); closeP(r.p, R.levene[3], 'levene3 p');
r = TS.tTestInd(D.a, D.b, true); close(r.t, R.student[0], 'student t'); closeP(r.p, R.student[1], 'student p'); close(r.df, R.student[2], 'student df');
close(r.ci[0], R.student_ci[0], 'student ci low'); close(r.ci[1], R.student_ci[1], 'student ci high');
r = TS.tTestInd(D.c, D.d, false); close(r.t, R.welch[0], 'welch t'); closeP(r.p, R.welch[1], 'welch p'); close(r.df, R.welch[2], 'welch df');
r = TS.mannWhitney(D.e, D.f); close(r.U, R.mwu[0], 'mwu U'); closeP(r.p, R.mwu[1], 'mwu p');
r = TS.mannWhitney(D.lik1, D.lik2); close(r.U, R.mwu_ties[0], 'mwu ties U'); closeP(r.p, R.mwu_ties[1], 'mwu ties p');
r = TS.anovaOneWay([D.g1, D.g2, D.g3]); close(r.F, R.anova[0], 'anova F'); closeP(r.p, R.anova[1], 'anova p');
r = TS.welchAnova([D.h1, D.h2, D.h3]); close(r.F, R.welch_anova[0], 'welch anova F'); closeP(r.p, R.welch_anova[1], 'welch anova p'); close(r.df2, R.welch_anova[2], 'welch anova df2');
r = TS.kruskal([D.k1, D.k2, D.k3]); close(r.H, R.kruskal[0], 'kruskal H'); closeP(r.p, R.kruskal[1], 'kruskal p');
r = TS.chiSquare(R.chi2_table); close(r.chi2, R.chi2[0], 'chi2'); closeP(r.p, R.chi2[1], 'chi2 p'); close(r.df, R.chi2[2], 'chi2 df');
r = TS.fisherExact([[8, 2], [1, 5]]); close(r.oddsRatio, R.fisher[0], 'fisher OR'); closeP(r.p, R.fisher[1], 'fisher p');
r = TS.fisherExact([[12, 5], [9, 14]]); close(r.oddsRatio, R.fisher2[0], 'fisher2 OR'); closeP(r.p, R.fisher2[1], 'fisher2 p');
r = TS.pearson(D.x, D.y); close(r.r, R.pearson[0], 'pearson r'); closeP(r.p, R.pearson[1], 'pearson p');
r = TS.spearman(D.ord1, D.ord2); close(r.rho, R.spearman[0], 'spearman rho'); closeP(r.p, R.spearman[1], 'spearman p');
r = TS.pairedT(D.post, D.pre); close(r.t, R.paired[0], 'paired t'); closeP(r.p, R.paired[1], 'paired p');
r = TS.wilcoxon(D.post.map((v, i) => v - D.pre[i])); close(r.W, R.wilcoxon[0], 'wilcoxon W'); closeP(r.p, R.wilcoxon[1], 'wilcoxon p');
r = TS.wilcoxon(D.dl); close(r.W, R.wilcoxon_ties[0], 'wilcoxon ties W'); closeP(r.p, R.wilcoxon_ties[1], 'wilcoxon ties p');
r = TS.oneSampleT(D.a, 3.0); close(r.t, R.one_sample[0], 'one-sample t'); closeP(r.p, R.one_sample[1], 'one-sample p');
close(TS.skewness(D.e), R.skew, 'skewness'); close(TS.kurtosis(D.e), R.kurt, 'kurtosis');
[0.25, 0.5, 0.75].forEach((q, i) => close(TS.quantile(D.e, q), R.quantiles[i], 'quantile ' + q));
[3, 10, 57.3, 400].forEach((df, i) => close(TS.tInv(0.975, df), R.t_inv[i], 't quantile df=' + df));
[0.025, 0.975].forEach((q, i) => close(TS.fInv(q, 4, 30), R.f_inv[i], 'F quantile ' + q));
[1e-9, 0.001, 0.025, 0.5, 0.975, 0.999999].forEach((q, i) => close(TS.normInv(q), R.norm_inv[i], 'normal quantile ' + q, 1e-9));
[-3, 0.5, 1.96, 5, 8.5].forEach((z, i) => closeP(TS.normSf(z), R.norm_sf[i], 'normal sf ' + z));
[[3.2, 1], [12.5, 4], [80, 30]].forEach(([v, k], i) => closeP(TS.chi2Sf(v, k), R.chi2_sf[i], 'chi2 sf ' + v));
r = TS.cronbach(D.items); close(r.alpha, R.alpha[0], 'alpha'); close(r.ci[0], R.alpha[1], 'alpha ci low'); close(r.ci[1], R.alpha[2], 'alpha ci high');
const X = D.X1.map((v, i) => [1, v, D.X2[i]]);
r = TS.ols(D.Y, X, ['const', 'x1', 'x2']);
r.coef.forEach((c, j) => { close(c.b, R.ols.b[j], 'ols b' + j); close(c.se, R.ols.se[j], 'ols se' + j); closeP(c.p, R.ols.p[j], 'ols p' + j); close(c.seHC3, R.ols.seHC3[j], 'ols HC3 se' + j); });
close(r.r2, R.ols.r2, 'ols R2'); close(r.F, R.ols.F, 'ols F'); close(r.bp.lm, R.ols.bp[0], 'Breusch-Pagan LM'); closeP(r.bp.p, R.ols.bp[1], 'Breusch-Pagan p');
r = TS.logistic(D.Yb, X, ['const', 'x1', 'x2']);
r.coef.forEach((c, j) => { close(c.b, R.logit.b[j], 'logit b' + j, 1e-5); close(c.se, R.logit.se[j], 'logit se' + j, 1e-5); close(c.p, R.logit.p[j], 'logit p' + j, 1e-4); });
close(r.mcfadden, R.logit.mcfadden, 'logit McFadden', 1e-6); close(r.lr, R.logit.llr, 'logit LR', 1e-6);
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
