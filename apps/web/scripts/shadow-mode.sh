#!/usr/bin/env bash
#
# VetIOS Shadow Mode Runner
#
# Runs the ML inference pipeline in shadow mode:
#   1. Fires requests to /api/inference (production-like payloads)
#   2. Captures all responses for comparison
#   3. Calls /api/ml/shadow-report for drift + calibration stats
#   4. Outputs a summary report
#
# Usage:
#   bash apps/web/scripts/shadow-mode.sh [BASE_URL] [NUM_CASES]
#
# Requires: curl, jq (optional)

set -euo pipefail

BASE_URL="${1:-http://localhost:3001}"
NUM_CASES="${2:-5}"

green() { printf "\033[32m%s\033[0m\n" "$1"; }
red()   { printf "\033[31m%s\033[0m\n" "$1"; }
bold()  { printf "\033[1m%s\033[0m\n" "$1"; }
dim()   { printf "\033[90m%s\033[0m\n" "$1"; }

bold "═══════════════════════════════════════════════════"
bold "  VetIOS Shadow Mode — Pre-Launch Validation"
bold "  Target: $BASE_URL | Cases: $NUM_CASES"
bold "═══════════════════════════════════════════════════"
echo ""

# ── Define test cases (representative real-world scenarios) ──

CASES=(
    '{"model":{"name":"gpt-4o-mini","version":"2024-07-18"},"input":{"input_signature":{"species":"canine","breed":"labrador","age_years":7,"symptoms":["lethargy","decreased appetite","polyuria"],"vitals":{"temp_f":103.2,"heart_rate":110,"weight_kg":28}}}}'
    '{"model":{"name":"gpt-4o-mini","version":"2024-07-18"},"input":{"input_signature":{"species":"feline","breed":"persian","age_years":3,"symptoms":["vomiting","diarrhea","weight loss"],"vitals":{"temp_f":100.5,"heart_rate":180,"weight_kg":3.5}}}}'
    '{"model":{"name":"gpt-4o-mini","version":"2024-07-18"},"input":{"input_signature":{"species":"equine","breed":"thoroughbred","age_years":12,"symptoms":["lameness","joint swelling","reluctance to move"],"vitals":{"temp_f":101.0,"heart_rate":46,"weight_kg":500}}}}'
    '{"model":{"name":"gpt-4o-mini","version":"2024-07-18"},"input":{"input_signature":{"species":"canine","breed":"german shepherd","age_years":9,"symptoms":["hip pain","difficulty rising","muscle wasting"],"vitals":{"temp_f":101.5,"heart_rate":90,"weight_kg":35}}}}'
    '{"model":{"name":"gpt-4o-mini","version":"2024-07-18"},"input":{"input_signature":{"species":"feline","breed":"siamese","age_years":15,"symptoms":["increased thirst","weight loss","behavioral changes"],"vitals":{"temp_f":99.8,"heart_rate":200,"weight_kg":3.0}}}}'
)

SUCCESSES=0
FAILURES=0
TOTAL_LATENCY=0
CONFIDENCE_SCORES=()
INFERENCE_IDS=()

# ── Run shadow inference ────────────────────────────────

bold "Phase 1: Shadow Inference ($NUM_CASES cases)"
echo ""

for i in $(seq 0 $((NUM_CASES - 1))); do
    CASE_IDX=$((i % ${#CASES[@]}))
    PAYLOAD="${CASES[$CASE_IDX]}"

    START_MS=$(date +%s%3N 2>/dev/null || python3 -c "import time; print(int(time.time()*1000))")

    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/inference" \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD" 2>/dev/null || echo -e "\n000")

    END_MS=$(date +%s%3N 2>/dev/null || python3 -c "import time; print(int(time.time()*1000))")

    STATUS=$(echo "$RESPONSE" | tail -1)
    BODY=$(echo "$RESPONSE" | sed '$d')

    LATENCY=$((END_MS - START_MS))
    TOTAL_LATENCY=$((TOTAL_LATENCY + LATENCY))

    if [ "$STATUS" = "200" ]; then
        SUCCESSES=$((SUCCESSES + 1))
        green "  Case $((i+1)): HTTP 200 (${LATENCY}ms)"

        # Extract fields
        if command -v jq &>/dev/null; then
            CONF=$(echo "$BODY" | jq -r '.confidence_score // "null"')
            EVENT_ID=$(echo "$BODY" | jq -r '.inference_event_id // ""')
            REQUEST_ID=$(echo "$BODY" | jq -r '.request_id // ""')
            CONFIDENCE_SCORES+=("$CONF")
            INFERENCE_IDS+=("$EVENT_ID")
            dim "    confidence: $CONF | event: ${EVENT_ID:0:8}... | req: $REQUEST_ID"
        fi
    else
        FAILURES=$((FAILURES + 1))
        red "  Case $((i+1)): HTTP $STATUS (${LATENCY}ms)"
        dim "    $BODY"
    fi

    # Small delay to not hit rate limit
    sleep 2
done

echo ""

# ── Phase 2: Shadow report from ML server ───────────────

bold "Phase 2: ML Shadow Report"

SHADOW_RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/ml/shadow-report" 2>/dev/null || echo -e "\n000")
SHADOW_STATUS=$(echo "$SHADOW_RESPONSE" | tail -1)
SHADOW_BODY=$(echo "$SHADOW_RESPONSE" | sed '$d')

if [ "$SHADOW_STATUS" = "200" ]; then
    green "  ✓ Shadow report retrieved (HTTP 200)"
    if command -v jq &>/dev/null; then
        ML_REACHABLE=$(echo "$SHADOW_BODY" | jq -r '.ml_server_reachable')
        dim "    ML server reachable: $ML_REACHABLE"

        SHADOW_EVAL=$(echo "$SHADOW_BODY" | jq -r '.shadow_evaluation // "null"')
        DRIFT=$(echo "$SHADOW_BODY" | jq -r '.drift_report // "null"')
        CALIBRATION=$(echo "$SHADOW_BODY" | jq -r '.calibration // "null"')

        if [ "$SHADOW_EVAL" != "null" ]; then
            green "    ✓ Shadow evaluation: available"
        else
            dim "    ○ Shadow evaluation: not available (ML server may be down)"
        fi
        if [ "$DRIFT" != "null" ]; then
            green "    ✓ Drift report: available"
        else
            dim "    ○ Drift report: not available"
        fi
        if [ "$CALIBRATION" != "null" ]; then
            green "    ✓ Calibration data: available"
        else
            dim "    ○ Calibration data: not available"
        fi
    fi
else
    red "  ✗ Shadow report failed (HTTP $SHADOW_STATUS)"
fi
echo ""

# ── Phase 3: ML Health Check ────────────────────────────

bold "Phase 3: ML Server Health"

ML_HEALTH=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/ml/predict" 2>/dev/null || echo -e "\n000")
ML_STATUS=$(echo "$ML_HEALTH" | tail -1)
ML_BODY=$(echo "$ML_HEALTH" | sed '$d')

if [ "$ML_STATUS" = "200" ]; then
    green "  ✓ ML predict endpoint reachable (HTTP 200)"
    if command -v jq &>/dev/null; then
        ML_UP=$(echo "$ML_BODY" | jq -r '.ml_server_reachable')
        dim "    ML server reachable: $ML_UP"
    fi
else
    dim "  ○ ML predict endpoint: HTTP $ML_STATUS (may be expected if ML server is separate)"
fi
echo ""

# ── Summary ─────────────────────────────────────────────

AVG_LATENCY=0
if [ "$SUCCESSES" -gt 0 ]; then
    AVG_LATENCY=$((TOTAL_LATENCY / NUM_CASES))
fi

bold "═══════════════════════════════════════════════════"
bold "  Shadow Mode Summary"
bold "═══════════════════════════════════════════════════"
echo ""
echo "  Cases run:       $NUM_CASES"
echo "  Successes:       $SUCCESSES"
echo "  Failures:        $FAILURES"
echo "  Avg latency:     ${AVG_LATENCY}ms"

if [ ${#CONFIDENCE_SCORES[@]} -gt 0 ]; then
    echo "  Confidences:     ${CONFIDENCE_SCORES[*]}"
fi

echo ""

if [ "$FAILURES" -eq 0 ] && [ "$SUCCESSES" -gt 0 ]; then
    green "  ✓ SHADOW MODE PASSED — Safe to proceed with deployment"
else
    red "  ✗ SHADOW MODE ISSUES — Review failures before deploying"
fi

bold "═══════════════════════════════════════════════════"

exit "$FAILURES"
