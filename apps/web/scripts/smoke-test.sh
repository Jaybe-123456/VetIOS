#!/usr/bin/env bash
set -euo pipefail

# Usage: SESSION_TOKEN=<token> bash apps/web/scripts/smoke-test.sh
BASE="${BASE:-http://localhost:3000}"
AUTH="Authorization: Bearer ${SESSION_TOKEN:-}"

echo "=== VetIOS Full Loop Smoke Test ==="

INFER=$(curl -s -X POST "$BASE/api/inference" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"model":{"name":"VetIOS Diagnostics","version":"latest"},"input":{"input_signature":{"species":"canine","symptoms":["vomiting","lethargy"],"metadata":{"age_years":3,"labs":{"wbc":4.1,"pcv":29}}}}}')
echo "[inference] $INFER"
EVENT_ID=$(echo "$INFER" | jq -r '.inference_event_id')
echo "[inference_event_id] $EVENT_ID"

OUTCOME=$(curl -s -X POST "$BASE/api/outcome" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"inference_event_id\":\"$EVENT_ID\",\"outcome\":{\"type\":\"confirmed_diagnosis\",\"payload\":{\"label\":\"canine_parvovirus\",\"confidence\":0.98},\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}}")
echo "[outcome] $OUTCOME"

SIM=$(curl -s -X POST "$BASE/api/simulate" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"steps":5,"mode":"adaptive","base_case":{"species":"canine","symptoms":["vomiting","lethargy"],"metadata":{"labs":{"wbc":4.1,"pcv":29}}},"inference":{"model":"VetIOS Diagnostics","model_version":"latest"}}')
echo "[simulate] $SIM"

EVAL=$(curl -s "$BASE/api/evaluation" -H "$AUTH")
echo "[evaluation] $EVAL"

HEALTH=$(curl -s "$BASE/api/health")
echo "[health] $HEALTH"

echo "[rate_limit] Sending 61 rapid requests..."
for i in $(seq 1 61); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/inference" \
    -H "$AUTH" -H "Content-Type: application/json" \
    -d '{"model":{"name":"VetIOS Diagnostics","version":"latest"},"input":{"input_signature":{"species":"canine","symptoms":["vomiting"]}}}')
  if [ "$CODE" = "429" ]; then
    echo "[rate_limit] 429 hit on request $i"
    break
  fi
done

echo "=== Done ==="
