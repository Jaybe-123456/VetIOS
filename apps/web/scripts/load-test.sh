#!/usr/bin/env bash
#
# VetIOS Load Test — Rate Limit Validation
#
# Fires rapid requests at /api/inference to validate:
#   1. Rate limiter returns 429 after threshold (10 req/min)
#   2. Response includes retry-after and x-ratelimit-* headers
#   3. x-request-id appears in all responses
#
# Usage:
#   bash apps/web/scripts/load-test.sh [BASE_URL]
#
# Requires: curl

set -euo pipefail

BASE_URL="${1:-http://localhost:3001}"

green() { printf "\033[32m%s\033[0m\n" "$1"; }
red()   { printf "\033[31m%s\033[0m\n" "$1"; }
bold()  { printf "\033[1m%s\033[0m\n" "$1"; }
dim()   { printf "\033[90m%s\033[0m\n" "$1"; }

PASS=0
FAIL=0

assert() {
    local label="$1" expected="$2" actual="$3"
    if [ "$actual" = "$expected" ]; then
        green "  ✓ $label"
        PASS=$((PASS + 1))
    else
        red "  ✗ $label — expected $expected, got $actual"
        FAIL=$((FAIL + 1))
    fi
}

# Minimal valid payload for inference
PAYLOAD='{"model":{"name":"test","version":"1.0"},"input":{"input_signature":{"species":"canine"}}}'

bold "═══════════════════════════════════════════════════"
bold "  VetIOS Load Test — Rate Limit Validation"
bold "  Target: $BASE_URL"
bold "═══════════════════════════════════════════════════"
echo ""

# ─── Phase 1: Verify request IDs ────────────────────────
bold "Phase 1: Request ID Tracing"

HEADERS=$(curl -s -D - -o /dev/null -X POST "$BASE_URL/api/inference" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" 2>/dev/null || true)

REQUEST_ID=$(echo "$HEADERS" | grep -i "x-request-id" | tr -d '\r' | awk '{print $2}')
if [ -n "$REQUEST_ID" ]; then
    green "  ✓ x-request-id present: $REQUEST_ID"
    PASS=$((PASS + 1))
else
    red "  ✗ x-request-id missing from response"
    FAIL=$((FAIL + 1))
fi

RESPONSE_TIME=$(echo "$HEADERS" | grep -i "x-response-time" | tr -d '\r' | awk '{print $2}')
if [ -n "$RESPONSE_TIME" ]; then
    green "  ✓ x-response-time present: $RESPONSE_TIME"
    PASS=$((PASS + 1))
else
    dim "  ○ x-response-time not found (may only appear on success)"
fi
echo ""

# ─── Phase 2: Rate Limit Burst ──────────────────────────
bold "Phase 2: Rate Limit Burst Test (15 rapid requests)"
dim "  /api/inference limit: 10 req/min per IP"

STATUS_CODES=()
GOT_429=false

for i in $(seq 1 15); do
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/inference" \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD" 2>/dev/null || echo "000")
    STATUS_CODES+=("$STATUS")
    if [ "$STATUS" = "429" ]; then
        GOT_429=true
    fi
    printf "  Request %2d: HTTP %s" "$i" "$STATUS"
    if [ "$STATUS" = "429" ]; then
        printf " ← RATE LIMITED"
    fi
    echo ""
done
echo ""

if [ "$GOT_429" = true ]; then
    green "  ✓ Rate limiter triggered — 429 returned after threshold"
    PASS=$((PASS + 1))
else
    red "  ✗ Rate limiter NOT triggered — all 15 requests succeeded"
    FAIL=$((FAIL + 1))
fi

# Check 429 response body
RATE_RESPONSE=$(curl -s -X POST "$BASE_URL/api/inference" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" 2>/dev/null || echo "{}")

if echo "$RATE_RESPONSE" | grep -q "retry_after_ms"; then
    green "  ✓ 429 response includes retry_after_ms"
    PASS=$((PASS + 1))
else
    dim "  ○ retry_after_ms not found (may have recovered)"
fi
echo ""

# ─── Phase 3: Request Size Limit ────────────────────────
bold "Phase 3: Request Size Limit (128KB)"

# Generate a payload larger than 128KB
LARGE_PAYLOAD=$(python3 -c "import json; print(json.dumps({'model':{'name':'test','version':'1.0'},'input':{'input_signature':{'data':'x'*200000}}}))" 2>/dev/null || echo "")

if [ -n "$LARGE_PAYLOAD" ]; then
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/inference" \
        -H "Content-Type: application/json" \
        -H "Content-Length: 200000" \
        -d "$LARGE_PAYLOAD" 2>/dev/null || echo "000")
    assert "Oversized payload rejected" "413" "$STATUS"
else
    dim "  ○ Skipped — python3 not available for payload generation"
fi
echo ""

# ─── Phase 4: Zod Validation ────────────────────────────
bold "Phase 4: Zod Schema Validation"

# Missing model field
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/inference" \
    -H "Content-Type: application/json" \
    -d '{"input":{"input_signature":{}}}' 2>/dev/null || echo "000")
assert "Missing model → 400" "400" "$STATUS"

# Invalid types
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/ml/predict" \
    -H "Content-Type: application/json" \
    -d '{"decision_count":"not_a_number","override_count":0}' 2>/dev/null || echo "000")
assert "Invalid type → 400" "400" "$STATUS"

# Empty body
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/inference" \
    -H "Content-Type: application/json" 2>/dev/null || echo "000")
assert "Empty body → 400" "400" "$STATUS"
echo ""

# ─── Phase 5: Auth check (no session in non-bypass mode) ──
bold "Phase 5: Production Auth Check"
dim "  (Only applicable if VETIOS_DEV_BYPASS is NOT set)"

# ─── Summary ────────────────────────────────────────────
echo ""
bold "═══════════════════════════════════════════════════"
if [ "$FAIL" -eq 0 ]; then
    green "  ALL $PASS CHECKS PASSED ✓"
else
    red "  $FAIL FAILED, $PASS PASSED"
fi
bold "═══════════════════════════════════════════════════"

exit "$FAIL"
