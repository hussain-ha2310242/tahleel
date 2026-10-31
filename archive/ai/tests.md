# Tests

## Personas

- **P1 Doctoral student:** plans a first pre/post study, works on a phone.
- **P2 Public health researcher:** estimates a proportion, handles health data.
- **P3 Statistician reviewer:** checks every number by hand.

## Flows

1. **Plan from one objective (P1).** Enter an objective. Expect a plan with a per-group sample, all lines editable, all values marked illustrative.
2. **Check a questionnaire (P1).** Enter "How satisfied are you with the teaching and the facilities?" Expect a double-barrelled flag with a rewrite.
3. **Draw from the simulated frame (P3).** Upload 2,000 students in 5 colleges, stratified proportional, n = 300. Expect 300 units, counts per college within ±1 of allocation, and a log with the seed.
4. **Analyse only after lock (P3).** Run analysis before the plan is locked. Expect a refusal that names the plan version.
5. **Ethics routing (P2).** Mark under-18s and health data. Expect guardian consent with child assent, and a health-data section in the data plan.
6. **Monitoring hides outcomes (P2).** Open monitoring with an outcome column in the data. Expect no outcome values shown.

## Numeric checks

- **N1:** d = 0.30, alpha 0.05, power 0.80. Per group = 2 × (1.96 + 0.8416)² / 0.30² = 174.4, rounded up to **175**.
- **P1:** n = 400, p = 0.50. Margin of error = 1.96 × √(0.25 / 400) = **±4.9**.
- **F1:** N = 2,000, e = 0.05, p = 0.50. n0 = 384.16; with FPC, n = 384.16 / (1 + 383.16 / 2,000) = **323**.
- **D1:** 25 per class, ICC 0.15. deff = 1 + 24 × 0.15 = **4.6**; effective n of 1,000 = **217**.
- **H1:** p-values 0.001, 0.01, 0.02, 0.04, 0.20, 0.50 at alpha 0.05. Holm rejects **2** (stops at 0.02 against 0.0125).
- **R1:** k = 6, mean inter-item r = 0.30. Standardised alpha = 1.8 / 2.5 = **0.72**.
- **R2:** three items, variances 1, covariances 0.5. Cronbach's alpha from the matrix = **0.75**, equal to the standardised value.
- **W1:** weights (2, 1, 1, 1). Kish efficiency = 25 / 28 = **89.3%**.
- **S1:** N = (1,000; 600; 400), n = 200, proportional allocation = **100, 60, 40**.

## Rules

- Reliability is never described as validity.
- Planning figures always carry "needs statistician review".
- No "Phi" or "φ" in page text.
