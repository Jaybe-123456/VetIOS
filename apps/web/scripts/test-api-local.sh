#!/usr/bin/env bash
#
# VetIOS API Local Test Script
#
# Tests all three API routes against a running Next.js dev server.
#
# Usage:
#   1. Start dev server:  pnpm -C apps/web dev
#   2. Run tests:         bash apps/web/scripts/test-api-local.sh
#
# Requires: curl. Uses jq if available, falls back to grep.

set -euo pipefail

BASE_URL="${API_BASE_URL:-http://localhost:3000}"
PASS=0
FAIL=0

green() { printf "\033[32m%s\033[0m\n" "$1"; }
red()   { printf "\033[31m%s\033[0m\n" "$1"; }
bold()  { printf "\033[1m%s\033[0m\n" "$1"; }

extract_field() {
    local json="$1"
    local field="$2"
    if command -v jq &>/dev/null; then
        echo "$json" | jq -r ".$field // empty"
    else
        echo "$json" | grep -oP "\"$field\"\s*:\s*\"?\K[^,\"}\s]+" | head -1
    fi
}

assert_status() {
    local label="$1"
    local expected="$2"
    local actual="$3"
    if [ "$actual" = "$expected" ]; then
        green "  ✓ $label (HTTP $actual)"
        PASS=$((PASS + 1))
    else
        red "  ✗ $label — expected HTTP $expected, got HTTP $actual"
        FAIL=$((FAIL + 1))
    fi
}

bold "═══════════════════════════════════════════"
bold "  VetIOS API Smoke Tests"
bold "  Target: $BASE_URL"
bold "═══════════════════════════════════════════"
echo ""

# ─── Test 1: Empty body → 400 ──────────────────────────
bold "Test 1: Empty body → 400"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/inference")
assert_status "/api/inference empty body" "400" "$STATUS"
echo ""

# ─── Test 2: Invalid JSON → 400 ────────────────────────
bold "Test 2: Invalid JSON → 400"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/inference" \
  -H "Content-Type: application/json" \
  -d "not json at all")
assert_status "/api/inference invalid JSON" "400" "$STATUS"
echo ""

# ─── Test 3: Missing fields → 400 ──────────────────────
bold "Test 3: Missing required fields → 400"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/inference" \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"test"}')
assert_status "/api/inference missing model" "400" "$STATUS"
echo ""

# ─── Test 4: Full inference call ────────────────────────
bold "Test 4: POST /api/inference (full payload)"
INFERENCE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/inference" \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "test-tenant-001",
    "clinic_id": "clinic-001",
    "case_id": "case-001",
    "model": { "name": "gpt-4o-mini", "version": "2024-07-18" },
    "input": {
      "input_signature": {
        "species": "canine",
        "breed": "labrador",
        "age_years": 7,
        "symptoms": ["lethargy", "decreased appetite", "polyuria"],
        "vitals": { "temp_f": 103.2, "heart_rate": 110, "weight_kg": 28 }
      }
    }
  }')

INFERENCE_STATUS=$(echo "$INFERENCE_RESPONSE" | tail -1)
INFERENCE_BODY=$(echo "$INFERENCE_RESPONSE" | sed '$d')
assert_status "/api/inference full call" "200" "$INFERENCE_STATUS"

INFERENCE_EVENT_ID=$(extract_field "$INFERENCE_BODY" "inference_event_id")
if [ -n "$INFERENCE_EVENT_ID" ]; then
    green "  → inference_event_id: $INFERENCE_EVENT_ID"
else
    red "  → No inference_event_id in response"
    FAIL=$((FAIL + 1))
fi
echo ""

# ─── Test 5: Outcome (using inference_event_id) ────────
bold "Test 5: POST /api/outcome"
if [ -n "$INFERENCE_EVENT_ID" ]; then
    OUTCOME_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/outcome" \
      -H "Content-Type: application/json" \
      -d "{
        \"tenant_id\": \"test-tenant-001\",
        \"inference_event_id\": \"$INFERENCE_EVENT_ID\",
        \"clinic_id\": \"clinic-001\",
        \"case_id\": \"case-001\",
        \"outcome\": {
          \"type\": \"diagnosis_confirmed\",
          \"payload\": { \"diagnosis\": \"cushing_syndrome\", \"confirmed_by\": \"veterinarian\" },
          \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
        }
      }")

    OUTCOME_STATUS=$(echo "$OUTCOME_RESPONSE" | tail -1)
    OUTCOME_BODY=$(echo "$OUTCOME_RESPONSE" | sed '$d')
    assert_status "/api/outcome" "200" "$OUTCOME_STATUS"

    OUTCOME_EVENT_ID=$(extract_field "$OUTCOME_BODY" "outcome_event_id")
    if [ -n "$OUTCOME_EVENT_ID" ]; then
        green "  → outcome_event_id: $OUTCOME_EVENT_ID"
    fi
else
    red "  ✗ Skipped — no inference_event_id"
    FAIL=$((FAIL + 1))
fi
echo ""

# ─── Test 6: Simulate ──────────────────────────────────
bold "Test 6: POST /api/simulate"
SIMULATE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/simulate" \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "test-tenant-001",
    "simulation": {
      "type": "rare_disease_adversarial",
      "parameters": {
        "species": "feline",
        "breed": "siamese",
        "age_years": 12,
        "symptoms": ["seizures", "ataxia", "blindness"],
        "severity": "critical"
      }
    },
    "inference": {
      "model": "gpt-4o-mini",
      "model_version": "2024-07-18"
    }
  }')

SIMULATE_STATUS=$(echo "$SIMULATE_RESPONSE" | tail -1)
SIMULATE_BODY=$(echo "$SIMULATE_RESPONSE" | sed '$d')
assert_status "/api/simulate" "200" "$SIMULATE_STATUS"

SIMULATION_EVENT_ID=$(extract_field "$SIMULATE_BODY" "simulation_event_id")
if [ -n "$SIMULATION_EVENT_ID" ]; then
    green "  → simulation_event_id: $SIMULATION_EVENT_ID"
fi
echo ""

# ─── Summary ────────────────────────────────────────────
bold "═══════════════════════════════════════════"
if [ "$FAIL" -eq 0 ]; then
    green "  ALL $PASS TESTS PASSED ✓"
else
    red "  $FAIL FAILED, $PASS PASSED"
fi
bold "═══════════════════════════════════════════"

exit "$FAIL"
