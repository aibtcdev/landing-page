#!/usr/bin/env bash
# One-off script to reconcile staged inbox payments that were never finalized.
# Hits GET /api/payment-status/{paymentId} which triggers reconcileStagedInboxPayment.
#
# Usage: ./scripts/reconcile-staged-payments.sh
#
# Run AFTER the reconciliation queue deploy is live (PR #586).

set -uo pipefail

BASE_URL="https://aibtc.com"
DELAY=2  # seconds between requests to avoid relay flooding

PAYMENT_IDS=(
  pay_5177008523194bf98dcfe31e43da6d9e
  pay_02c413ea58e2453fb53f9ce7365c4010
  pay_784e0e3d07464e72971f740a0a124b47
  pay_b6a44b32cc2847d191e507e8a8f84d07
  pay_b71e5b82c5ee47428185f24c18d66291
  pay_1e40ec4def79401fa9efe6ec3c65bc96
  pay_4978ee0ba81349f089c33255b36fd19c
  pay_892ff8b2a4644147b5763bae933e63fb
  pay_7b53a8b27a7f4f26bcbd6472f298da53
  pay_1560dd0afdd146e38e806bee45c8b129
  pay_03575f1811d84e3c92f9cfbe165ccbd7
  pay_cd4c65165a264fc69648318b02135ac3
  pay_90ec3152b33f47149eacbc9def55d6b6
  pay_577c00226151416bb62eb2df1353c377
  pay_7f3cdf7b85684237ad256b3dcd07c5a0
  pay_3aec654d6ad04eee9998d73ca6dbd6b5
  pay_262e2123f2624f15a9dd3fe33b7eb0fb
  pay_f822bf3f413a4f48ade8cb919706df98
  pay_6116adb8b32e476e8829a8cd4d1a92a2
  pay_435511d5b4364a75b7698cd45622469b
  pay_e53906304d2b412fb8fd5d394919437b
  pay_bb7e63e4e2744b8aa281956de9b71f4e
  pay_50aa27c59fec4d48a4aa0ece8d19d633
  pay_7157a3794ec84cf385e6944f882e6e48
  pay_4e1487b400c24fbb916a43f49d337856
)

echo "Reconciling ${#PAYMENT_IDS[@]} staged payments..."
echo ""

finalized=0
discarded=0
pending=0
not_found=0
errors=0

for pid in "${PAYMENT_IDS[@]}"; do
  response=$(curl -s -w "\n%{http_code}" "${BASE_URL}/api/payment-status/${pid}")
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | head -1)
  status=$(echo "$body" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status','?'))" 2>/dev/null || echo "parse_error")

  case "$status" in
    confirmed) result="FINALIZED"; finalized=$((finalized+1)) ;;
    failed|replaced) result="DISCARDED"; discarded=$((discarded+1)) ;;
    not_found) result="NOT_FOUND"; not_found=$((not_found+1)) ;;
    queued|pending|submitted|mempool) result="STILL_PENDING"; pending=$((pending+1)) ;;
    *) result="ERROR($http_code)"; errors=$((errors+1)) ;;
  esac

  printf "  %-42s → %s (status=%s)\n" "$pid" "$result" "$status"
  sleep "$DELAY"
done

echo ""
echo "Results: ${finalized} finalized, ${discarded} discarded, ${pending} pending, ${not_found} not_found, ${errors} errors"
echo "Total: ${#PAYMENT_IDS[@]}"
