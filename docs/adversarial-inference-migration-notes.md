# Adversarial Inference Migration Notes

## New Response Fields

The inference payload now includes these top-level fields:

- `contradiction_score`
- `contradiction_reasons`
- `confidence_cap`
- `was_capped`
- `abstain_recommendation`
- `abstain_reason`
- `rule_overrides`
- `differential_spread`
- `uncertainty_notes`
- `telemetry`

For backward compatibility, `output_payload.contradiction_analysis` is also populated.

## Behavior Changes

- Contradictions now reduce confidence and widen uncertainty instead of deleting high-signal syndromic evidence.
- High-risk emergency persistence can keep diagnoses such as `Gastric Dilatation-Volvulus (GDV)` and `Acute Mechanical Emergency` in the leading differential set.
- `abstain_recommendation` may be `true` while `risk_assessment.emergency_level` remains `CRITICAL`.

## Type/Schema Notes

- `differential_spread.spread` is now emitted as a numeric value instead of a preformatted string.
- `telemetry` contains:
  - `pre_cap_confidence`
  - `post_cap_confidence`
  - `contradiction_triggers`
  - `persistence_rule_triggers`
  - `model_version`
  - `inference_id`
  - `simulation_id`

## Offline/Local Testing

The adversarial regression suite can run offline by using:

```powershell
node --experimental-strip-types --loader ./internal/testing/alias-loader.mjs ./internal/testing/test_adversarial_regressions.ts
```

This uses the deterministic local reasoning fallback and does not require live provider access.
