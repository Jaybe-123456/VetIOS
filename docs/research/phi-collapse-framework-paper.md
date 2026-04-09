# The Phi-Collapse Framework for Universal Intelligence Degradation Monitoring

## Abstract
The Phi-Collapse framework introduces a real-time reliability monitoring paradigm for AI systems that does not depend on ground-truth labels at inference time. We define `Phi-hat` as a normalized output-richness measure over the model's own probability distribution, derive a Collapse Proximity Score (CPS) from rolling instability dynamics, and introduce the Hysteresis Irreversibility Index (HII) as a measure of recovery failure after impairment sweeps. We implement the framework in VetIOS through the Clinical Inference Reliability Engine (CIRE) and expose it externally through Sovereign, a standalone API for cross-system stress characterization.

## 1. Universal Phi Definition Across System Classes
`Phi-hat` is defined from the system's output probability vector `D`:

`Phi-hat = 1 - H(D) / log(|D|)`

where `H(D)` is Shannon entropy over the normalized output distribution. The metric is high when the system maintains structured, discriminative output and low when output degenerates toward flat uncertainty or collapse. Because `Phi-hat` is derived from the model's own output distribution, it applies across language models, classifiers, diagnostic engines, and hybrid clinical decision systems.

## 2. Phase Transition Taxonomy
We characterize degradation under impairment `m` in three phases:

1. Nominal phase: low impairment, high `Phi-hat`, low CPS, stable deltas.
2. Pre-cliff phase: local instability emerges, rolling delta becomes negative, sigma rises.
3. Collapse phase: `Phi-hat` crosses the empirical threshold `m-dagger` and output suppression or abstention becomes the safe action.

The framework localizes `m-dagger` empirically through perturbation sweeps rather than hardcoded assumptions. In VetIOS, `m-dagger` is stored per capability inside the CIRE collapse profile.

## 3. Phi-Sentinel Algorithm and CPS Metric
The Phi-Sentinel runtime computes:

- `Phi-hat(t)` from the returned differential vector
- `Delta-bar(t)` as the rolling EMA of `Delta-hat`
- `sigma-delta(t)` as rolling instability volatility
- `m-hat` as an estimate of input impairment from incompleteness, contradiction, and out-of-distribution structure

The Collapse Proximity Score is:

`CPS = 0.40 * (1 - Phi-hat / Phi0) + 0.35 * max(0, -Delta-bar) / Phi0 + 0.25 * sigma-delta / Phi0`

Safety states are then classified as:

- `nominal` for `CPS < 0.25`
- `warning` for `0.25 <= CPS < 0.50`
- `critical` for `0.50 <= CPS < 0.75`
- `blocked` for `CPS >= 0.75`

In clinical settings, `blocked` is a successful safety action, not a system failure.

## 4. Hysteresis Irreversibility Index
Reliability loss is not fully captured by forward degradation alone. We define:

`HII = 1 - Phi-recovered / Phi0`

where `Phi-recovered` is measured after a reverse sweep from high impairment back to zero. HII close to zero indicates reversible degradation; high HII indicates retained structural damage or calibration drift after the system exits its stressed regime.

## 5. Empirical Validation in VetIOS
VetIOS provides a clinically grounded implementation domain:

- the Adversarial Simulation Lab measures empirical collapse profiles over structured veterinary inference
- CIRE evaluates every inference in real time using tenant-scoped rolling state persisted in the database
- critical and blocked states generate incidents, alerts, and audit events
- suppressed outputs are visible to operators in the Inference Console and resolvable from the System Dashboard

This implementation demonstrates that collapse-aware monitoring can be integrated into a production clinical AI operating system without requiring ground-truth labels at runtime.

## Implementation Artifacts
- `@vetios/cire-engine`: shared runtime computation package
- VetIOS CIRE APIs: tenant-scoped status, incidents, calibration, history, and collapse-profile endpoints
- Sovereign API: standalone registration, run, benchmark, report, and sentinel-config endpoints

## Submission Targets
- NeurIPS Safety Workshop
- AIES
- Nature Machine Intelligence

## VetIOS Claim
VetIOS is positioned as the first clinical AI system to operationalize and externally expose a collapse characterization framework with live suppression semantics, empirical calibration sweeps, and hysteresis-aware monitoring.
