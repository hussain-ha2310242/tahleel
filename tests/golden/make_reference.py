"""Reference values for Tahleel's JavaScript statistics, computed with scipy and statsmodels.
Run: python3 tests/golden/make_reference.py   (writes tests/golden/reference.json)"""
import json, math
import numpy as np
from scipy import stats
import statsmodels.api as sm
from statsmodels.stats.oneway import anova_oneway
from statsmodels.stats.diagnostic import het_breuschpagan

rng = np.random.default_rng(20261101)
R = lambda a: [float(v) for v in a]
cases = {}

# Datasets
a = rng.normal(3.2, 0.8, 40); b = rng.normal(3.6, 0.8, 45)              # normal, equal variance
c = rng.normal(3.0, 0.5, 30); d = rng.normal(3.5, 1.6, 50)               # unequal variance
e = rng.exponential(1.0, 35); f = rng.exponential(1.6, 38)               # skewed
lik1 = rng.integers(1, 6, 60).astype(float); lik2 = np.clip(np.round(rng.normal(3.6, 1.1, 55)), 1, 5)  # Likert with ties
g1 = rng.normal(3.0, 0.7, 30); g2 = rng.normal(3.4, 0.7, 28); g3 = rng.normal(3.9, 0.7, 33)          # three groups
h1 = rng.normal(3.0, 0.4, 25); h2 = rng.normal(3.3, 1.2, 40); h3 = rng.normal(3.8, 0.8, 35)          # unequal variances
k1 = np.clip(np.round(rng.normal(2.8, 1, 30)), 1, 5); k2 = np.clip(np.round(rng.normal(3.3, 1, 30)), 1, 5); k3 = np.clip(np.round(rng.normal(3.6, 1, 30)), 1, 5)
x = rng.normal(0, 1, 80); y = 0.45 * x + rng.normal(0, 0.9, 80)
ord1 = np.clip(np.round(3 + x), 1, 5); ord2 = np.clip(np.round(3 + y), 1, 5)
pre = rng.normal(3.1, 0.7, 42); post = pre + rng.normal(0.25, 0.5, 42)
sm_n = [rng.normal(0, 1, n) for n in (3, 4, 5, 7, 11, 12, 20, 50, 200, 1000)]

cases['data'] = {k: R(v) for k, v in dict(a=a, b=b, c=c, d=d, e=e, f=f, lik1=lik1, lik2=lik2, g1=g1, g2=g2, g3=g3, h1=h1, h2=h2, h3=h3, k1=k1, k2=k2, k3=k3, x=x, y=y, ord1=ord1, ord2=ord2, pre=pre, post=post).items()}
cases['data']['sw'] = [R(v) for v in sm_n]

ref = {}
ref['shapiro'] = [list(map(float, stats.shapiro(v))) for v in sm_n] + [list(map(float, stats.shapiro(v))) for v in (e, lik1)]
ref['levene'] = [float(v) for v in stats.levene(c, d)] + [float(v) for v in stats.levene(h1, h2, h3)]
t = stats.ttest_ind(a, b, equal_var=True); ref['student'] = [float(t.statistic), float(t.pvalue), float(t.df)]
t = stats.ttest_ind(c, d, equal_var=False); ref['welch'] = [float(t.statistic), float(t.pvalue), float(t.df)]
ci = stats.ttest_ind(a, b, equal_var=True).confidence_interval(); ref['student_ci'] = [float(ci.low), float(ci.high)]
u = stats.mannwhitneyu(e, f, alternative='two-sided', method='asymptotic', use_continuity=True); ref['mwu'] = [float(u.statistic), float(u.pvalue)]
u = stats.mannwhitneyu(lik1, lik2, alternative='two-sided', method='asymptotic', use_continuity=True); ref['mwu_ties'] = [float(u.statistic), float(u.pvalue)]
an = stats.f_oneway(g1, g2, g3); ref['anova'] = [float(an.statistic), float(an.pvalue)]
w = anova_oneway([h1, h2, h3], use_var='unequal', welch_correction=True); ref['welch_anova'] = [float(w.statistic), float(w.pvalue), float(w.df[1])]
kw = stats.kruskal(k1, k2, k3); ref['kruskal'] = [float(kw.statistic), float(kw.pvalue)]
tab = np.array([[30, 14, 6], [18, 22, 15]]); ch = stats.chi2_contingency(tab, correction=False); ref['chi2'] = [float(ch[0]), float(ch[1]), int(ch[2])]
ref['chi2_table'] = tab.tolist()
ft = stats.fisher_exact([[8, 2], [1, 5]]); ref['fisher'] = [float(ft.statistic), float(ft.pvalue)]
ft2 = stats.fisher_exact([[12, 5], [9, 14]]); ref['fisher2'] = [float(ft2.statistic), float(ft2.pvalue)]
pr = stats.pearsonr(x, y); ref['pearson'] = [float(pr.statistic), float(pr.pvalue)]
sp = stats.spearmanr(ord1, ord2); ref['spearman'] = [float(sp.statistic), float(sp.pvalue)]
pt = stats.ttest_rel(post, pre); ref['paired'] = [float(pt.statistic), float(pt.pvalue)]
wl = stats.wilcoxon(post - pre, method='approx', correction=False, zero_method='wilcox'); ref['wilcoxon'] = [float(wl.statistic), float(wl.pvalue)]
dl = post - np.round(pre, 1); dl = np.round(dl, 1)
wl2 = stats.wilcoxon(dl, method='approx', correction=False, zero_method='wilcox'); ref['wilcoxon_ties'] = [float(wl2.statistic), float(wl2.pvalue)]; cases['data']['dl'] = R(dl)
os1 = stats.ttest_1samp(a, 3.0); ref['one_sample'] = [float(os1.statistic), float(os1.pvalue)]
ref['skew'] = float(stats.skew(e, bias=False)); ref['kurt'] = float(stats.kurtosis(e, bias=False))
ref['quantiles'] = [float(np.quantile(e, q)) for q in (0.25, 0.5, 0.75)]
ref['t_inv'] = [float(stats.t.ppf(0.975, df)) for df in (3, 10, 57.3, 400)]
ref['f_inv'] = [float(stats.f.ppf(q, 4, 30)) for q in (0.025, 0.975)]
ref['norm_inv'] = [float(stats.norm.ppf(q)) for q in (1e-9, 0.001, 0.025, 0.5, 0.975, 0.999999)]
ref['norm_sf'] = [float(stats.norm.sf(z)) for z in (-3, 0.5, 1.96, 5, 8.5)]
ref['chi2_sf'] = [float(stats.chi2.sf(v, k)) for v, k in ((3.2, 1), (12.5, 4), (80, 30))]

# Cronbach's alpha: 4 items from one factor
lat = rng.normal(0, 1, 120)
items = np.array([np.clip(np.round(3 + 0.9 * lat + rng.normal(0, 0.8, 120)), 1, 5) for _ in range(4)])
cases['data']['items'] = [R(v) for v in items]
k = items.shape[0]; tot = items.sum(axis=0)
alpha = k / (k - 1) * (1 - items.var(axis=1, ddof=1).sum() / tot.var(ddof=1))
n = items.shape[1]
ref['alpha'] = [float(alpha), float(1 - (1 - alpha) * stats.f.ppf(0.975, n - 1, (n - 1) * (k - 1))), float(1 - (1 - alpha) * stats.f.ppf(0.025, n - 1, (n - 1) * (k - 1)))]

# OLS with HC3, Breusch-Pagan, and logistic regression
X1 = rng.normal(0, 1, 150); X2 = rng.integers(0, 2, 150).astype(float); Y = 1 + 0.6 * X1 + 0.4 * X2 + rng.normal(0, 1 + 0.5 * np.abs(X1), 150)
cases['data'].update(X1=R(X1), X2=R(X2), Y=R(Y))
Xm = sm.add_constant(np.column_stack([X1, X2])); m = sm.OLS(Y, Xm).fit(); mh = sm.OLS(Y, Xm).fit(cov_type='HC3')
bp = het_breuschpagan(m.resid, Xm)
ref['ols'] = dict(b=R(m.params), se=R(m.bse), p=R(m.pvalues), r2=float(m.rsquared), F=float(m.fvalue), seHC3=R(mh.bse), bp=[float(bp[0]), float(bp[1])])
Yb = (rng.random(150) < 1 / (1 + np.exp(-(-0.3 + 0.9 * X1 + 0.5 * X2)))).astype(float)
cases['data']['Yb'] = R(Yb)
lg = sm.Logit(Yb, Xm).fit(disp=0)
ref['logit'] = dict(b=R(lg.params), se=R(lg.bse), p=R(lg.pvalues), mcfadden=float(lg.prsquared), llr=float(lg.llr))

cases['ref'] = ref
json.dump(cases, open(__file__.replace('make_reference.py', 'reference.json'), 'w'))
print('reference values:', len(ref))
