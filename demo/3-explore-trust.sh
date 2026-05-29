#!/usr/bin/env bash
# 3-explore-trust.sh — Explore the Trust Registry: reputation data that drives agent decisions
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../agent/.env"

echo "═══════════════════════════════════════════════════════════════════"
echo "  Trust Registry Exploration"
echo "═══════════════════════════════════════════════════════════════════"
echo

# 1. Overview
echo "┌─────────────────────────────────────────────────────────────────┐"
echo "│ 1. All Merchants — Summary View                                 │"
echo "└─────────────────────────────────────────────────────────────────┘"
echo
curl -s "$TRUST_REGISTRY_URL/merchants" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(f'{'Merchant':<20} {'Trust':<8} {'Txns':<8} {'Disputes':<10} {'Badges/Warnings'}')
print('-' * 75)
for m in data['merchants']:
    score = f'{m[\"trustScore\"]}/5' if m['trustScore'] else 'N/A'
    badges = ', '.join(m.get('badges', []))
    warnings = ', '.join(m.get('warnings', []))
    flags = badges if badges else warnings if warnings else '—'
    print(f'{m[\"name\"]:<20} {score:<8} {m[\"totalTransactions\"]:<8} {m[\"disputeRate\"]*100:.0f}%{\"\":<7} {flags}')
"
echo

# 2. Premium publisher (high trust)
echo "┌─────────────────────────────────────────────────────────────────┐"
echo "│ 2. MediaTech Daily — Premium Publisher (Trust: 4.8/5)           │"
echo "└─────────────────────────────────────────────────────────────────┘"
echo
curl -s "$TRUST_REGISTRY_URL/merchants/mediatech-daily/reputation" | python3 -m json.tool
echo

# 3. Unreliable publisher (low trust)
echo "┌─────────────────────────────────────────────────────────────────┐"
echo "│ 3. Copperview — Budget Aggregator (Trust: 2.1/5)                 │"
echo "└─────────────────────────────────────────────────────────────────┘"
echo
curl -s "$TRUST_REGISTRY_URL/merchants/copperview/reputation" | python3 -m json.tool
echo

# 4. New entrant (no history)
echo "┌─────────────────────────────────────────────────────────────────┐"
echo "│ 4. Thornwick Research — New Entrant (Trust: N/A, 3 transactions)       │"
echo "└─────────────────────────────────────────────────────────────────┘"
echo
curl -s "$TRUST_REGISTRY_URL/merchants/thornwick/reputation" | python3 -m json.tool
echo

echo "═══════════════════════════════════════════════════════════════════"
echo "  Key takeaway: The agent queries this BEFORE spending money."
echo "  Trust + price + quality signals = informed purchasing decisions."
echo "═══════════════════════════════════════════════════════════════════"
