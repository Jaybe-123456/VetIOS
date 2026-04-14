# Φ-Collapse: Universal Intelligence Degradation and Production Sentinel Control

**Abstract.** We describe a distribution-only reliability layer for stochastic clinical and general AI systems. The framework defines an output-derived richness statistic Φ̂, a collapse proximity score (CPS) that couples Φ̂ with temporal instability, and a hysteresis irreversibility index (HII) measured under adversarial sweeps. VetIOS implements this layer as **CIRE** (Clinical Inference Reliability Engine); **Sovereign** exposes the same mathematics as a standalone stress-testing API for third-party endpoints. No ground-truth labels are required at inference time.

---

## 1. Universal Φ across system classes

Let \(D\) be a discrete differential (probability vector) emitted by the system. Define Shannon entropy  
\(H(D) = -\sum_i p_i \log p_i\) for normalized probabilities \(p_i\) (support may be sparse). Richness  
\[
\hat{\Phi} = 1 - \frac{H(D)}{\log |D|}
\]
lies in \([0,1]\): peaked distributions approach 1; uniform distributions approach 0. This construction applies to classifiers, calibrated LLM head distributions, and structured diagnostic differentials—any system that exposes a probability mass over a finite label set.

---

## 2. Phase transitions and \(m^\dagger\)

Stress testing applies a synthetic impairment level \(m \in [0,1]\) mixing noise, incompleteness, and contradiction. Empirical curves \(\hat{\Phi}(m)\) exhibit loss of structure; inflections in \(\hat{\Phi}''(m)\) localize rapid phase change. The collapse threshold \(m^\dagger\) is estimated where \(\hat{\Phi}\) crosses \(\tfrac{1}{2}\Phi_0\) for baseline \(\Phi_0 = \hat{\Phi}(0)\). Capability-specific maps \(\{m^\dagger\}\) are stored per model version—never hardcoded—and refreshed after each release.

---

## 3. Φ-Sentinel and CPS

Rolling state uses an EMA on \(\hat{\Phi}\), a perturbation signal \(\bar{\Delta}\), and volatility \(\sigma_\Delta\) over a fixed window. Collapse proximity aggregates deviation from baseline and instability:

\[
\mathrm{CPS} = 0.40\left(1 - \frac{\hat{\Phi}}{\Phi_0}\right)
+ 0.35\frac{\max(0,-\bar{\Delta})}{\Phi_0}
+ 0.25\frac{\sigma_\Delta}{\Phi_0}
\]

Threshold bands map CPS to `nominal` / `warning` / `critical` / `blocked` with paired reliability badges. **PhiSentinel** wraps arbitrary async inference functions with the same CPS logic for enterprise drop-in use.

---

## 4. HII as irreversibility

A reverse sweep \(m: 1 \to 0\) measures recovery \(\hat{\Phi}\) at \(m=0\). Define  
\[
\mathrm{HII} = 1 - \frac{\hat{\Phi}_{\mathrm{recovered}}}{\Phi_0},
\]
with \(\mathrm{HII} \in [0,1]\). Values above 0.3 trigger retraining recommendations and governance alerts—irreversible collapse under stress is a stronger signal than a single low-\(\hat{\Phi}\) snapshot.

---

## 5. Empirical validation on VetIOS

VetIOS logs append-only `ai_inference_events`, pairs outcomes where available, and runs adversarial simulations tied to `cire_collapse_profiles`. CIRE snapshots and incidents provide an audit trail; governance events record \(\hat{\Phi}\), CPS, safety state, and input quality for compliance review.

---

## Publication venues (targets)

- NeurIPS Safety Workshop  
- AIES (AI, Ethics, and Society)  
- *Nature Machine Intelligence* (methods / safe deployment track)

VetIOS is positioned as a clinical deployment with published collapse characterization methodology, supporting external credibility for procurement and regulatory dialogue.

---

## Implementation references (repository)

- Shared numerics: `@vetios/cire-engine` (`computePhiHat`, `computeCPS`, `classifySafetyState`, `updateRollingState`, `PhiSentinel`).
- Product A: `apps/web/lib/cire/engine.ts`, `/api/inference`, `/api/cire/*`.
- Product B: `apps/web/app/sovereign/*`, `apps/web/lib/sovereign/service.ts`.
