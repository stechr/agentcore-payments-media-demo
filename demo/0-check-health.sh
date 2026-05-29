#!/usr/bin/env bash
# 0-check-health.sh — Pre-demo health check: wallet, session, merchant reachability
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$SCRIPT_DIR/../agent"
PYTHON="$AGENT_DIR/.venv/bin/python"

source "$AGENT_DIR/.env"

echo "═══════════════════════════════════════════════════════"
echo "  AgentCore Payments PoC — Health Check"
echo "═══════════════════════════════════════════════════════"
echo

# 1. Check merchant reachability
echo "① Merchant reachability..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$MERCHANT_URL/merchants.json")
if [ "$HTTP_CODE" = "200" ]; then
  echo "   ✅ Merchant reachable ($MERCHANT_URL)"
elif [ "$HTTP_CODE" = "403" ]; then
  echo "   ❌ WAF blocked (403) — your IP is not allowlisted"
  echo "   Your IP: $(curl -s ifconfig.me)"
  echo "   Fix: update WAF IP set in us-east-1 console"
  exit 1
else
  echo "   ❌ Unexpected HTTP $HTTP_CODE"
  exit 1
fi

# 2. Check wallet balance and session
echo "② Payment resources..."
$PYTHON -c "
from bedrock_agentcore.payments.manager import PaymentManager
import os

pm = PaymentManager(payment_manager_arn=os.environ['PAYMENT_MANAGER_ARN'], region_name='us-east-1')

# Instrument
inst = pm.get_payment_instrument(
    payment_instrument_id=os.environ['PAYMENT_INSTRUMENT_ID'],
    user_id='researcher001')
print(f'   ✅ Instrument: {inst[\"paymentInstrumentId\"]} — Status: {inst[\"status\"]}')

# Balance
bal = pm.get_payment_instrument_balance(
    payment_connector_id='<YOUR_CONNECTOR_ID>',
    payment_instrument_id=os.environ['PAYMENT_INSTRUMENT_ID'],
    chain='BASE_SEPOLIA', token='USDC', user_id='researcher001')
amount = bal['tokenBalance']['amount']
print(f'   ✅ Wallet balance: {amount} USDC')
if float(amount) < 0.1:
    print('   ⚠️  Low balance! Fund at https://faucet.circle.com (Base Sepolia)')

# Session
try:
    sess = pm.get_payment_session(
        payment_session_id=os.environ['PAYMENT_SESSION_ID'],
        user_id='researcher001')
    avail = sess.get('availableLimits', {}).get('availableSpendAmount', {}).get('value', '?')
    max_spend = sess.get('limits', {}).get('maxSpendAmount', {}).get('value', '?')
    print(f'   ✅ Session: \${avail} available of \${max_spend} budget')
except Exception as e:
    print(f'   ❌ Session expired or not found: {e}')
    print('   Fix: run demo/0-new-session.sh')
    exit(1)
"

# 3. Trust Registry
echo "③ Trust Registry..."
TRUST_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$TRUST_REGISTRY_URL/merchants")
if [ "$TRUST_CODE" = "200" ]; then
  echo "   ✅ Trust Registry reachable"
else
  echo "   ❌ Trust Registry returned HTTP $TRUST_CODE"
fi

# 4. Feedback Service
echo "④ Feedback Service..."
FEEDBACK_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$FEEDBACK_URL/health" 2>/dev/null || echo "000")
if [ "$FEEDBACK_CODE" = "200" ] || [ "$FEEDBACK_CODE" = "404" ]; then
  echo "   ✅ Feedback Service reachable"
else
  echo "   ⚠️  Feedback Service returned HTTP $FEEDBACK_CODE (may still work for POST)"
fi

echo
echo "═══════════════════════════════════════════════════════"
echo "  All checks passed — ready to demo!"
echo "═══════════════════════════════════════════════════════"
