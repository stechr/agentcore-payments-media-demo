#!/usr/bin/env bash
# 2-explore-merchants.sh — Explore the merchant layer: catalogs, pricing, 402 responses
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../agent/.env"

echo "═══════════════════════════════════════════════════════════════════"
echo "  Merchant Layer Exploration"
echo "═══════════════════════════════════════════════════════════════════"
echo

# 1. Merchant directory
echo "┌─────────────────────────────────────────────────────────────────┐"
echo "│ 1. Merchant Directory (free — no payment required)              │"
echo "└─────────────────────────────────────────────────────────────────┘"
echo
curl -s "$MERCHANT_URL/merchants.json" | python3 -m json.tool
echo

# 2. Catalogs
echo "┌─────────────────────────────────────────────────────────────────┐"
echo "│ 2. Content Catalogs (free — agents discover content here)       │"
echo "└─────────────────────────────────────────────────────────────────┘"
echo
for merchant in mediatech copperview thornwick kettlebrook; do
  echo "--- $merchant ---"
  curl -s "$MERCHANT_URL/$merchant/catalog.json" | python3 -m json.tool 2>/dev/null || echo "  (no catalog)"
  echo
done

# 3. Hit the paywall
echo "┌─────────────────────────────────────────────────────────────────┐"
echo "│ 3. Paywall Demo — requesting premium content without payment    │"
echo "└─────────────────────────────────────────────────────────────────┘"
echo
echo "GET $MERCHANT_URL/mediatech/premium/agent-traffic-report.json"
echo
RESPONSE=$(curl -s -w "\n---HTTP_STATUS:%{http_code}---" "$MERCHANT_URL/mediatech/premium/agent-traffic-report.json")
HTTP_STATUS=$(echo "$RESPONSE" | grep -o 'HTTP_STATUS:[0-9]*' | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed 's/---HTTP_STATUS:[0-9]*---//')

echo "HTTP Status: $HTTP_STATUS (Payment Required)"
echo
echo "x402 Payment Payload:"
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
echo

# 4. Price comparison
echo "┌─────────────────────────────────────────────────────────────────┐"
echo "│ 4. Price Comparison — same tier across merchants                │"
echo "└─────────────────────────────────────────────────────────────────┘"
echo
echo "Premium tier pricing:"
for merchant in mediatech copperview thornwick kettlebrook; do
  PRICE=$(curl -s "$MERCHANT_URL/$merchant/premium/x" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'\${d[\"pricing\"][\"amount\"]}')" 2>/dev/null || echo "N/A")
  printf "  %-15s %s\n" "$merchant" "$PRICE"
done
echo
echo "Standard tier pricing:"
for merchant in mediatech copperview thornwick kettlebrook; do
  PRICE=$(curl -s "$MERCHANT_URL/$merchant/articles/x" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'\${d[\"pricing\"][\"amount\"]}')" 2>/dev/null || echo "N/A")
  printf "  %-15s %s\n" "$merchant" "$PRICE"
done
echo
echo "═══════════════════════════════════════════════════════════════════"
echo "  Key takeaway: Same content type, 5-15x price difference."
echo "  The agent must decide: is expensive = better?"
echo "═══════════════════════════════════════════════════════════════════"
