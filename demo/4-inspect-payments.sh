#!/usr/bin/env bash
# 4-inspect-payments.sh — Inspect AgentCore payment resources: wallet, session, balance
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$SCRIPT_DIR/../agent"
PYTHON="$AGENT_DIR/.venv/bin/python"

source "$AGENT_DIR/.env"

echo "═══════════════════════════════════════════════════════════════════"
echo "  AgentCore Payment Resources"
echo "═══════════════════════════════════════════════════════════════════"
echo

$PYTHON -c "
from bedrock_agentcore.payments.manager import PaymentManager
import os, json

pm = PaymentManager(payment_manager_arn=os.environ['PAYMENT_MANAGER_ARN'], region_name='us-east-1')

print('┌─────────────────────────────────────────────────────────────────┐')
print('│ 1. Payment Instrument (Embedded Wallet)                         │')
print('└─────────────────────────────────────────────────────────────────┘')
print()
inst = pm.get_payment_instrument(
    payment_instrument_id=os.environ['PAYMENT_INSTRUMENT_ID'],
    user_id='researcher001')
print(json.dumps(inst, indent=2, default=str))

print()
print('┌─────────────────────────────────────────────────────────────────┐')
print('│ 2. Wallet Balance (Base Sepolia USDC)                           │')
print('└─────────────────────────────────────────────────────────────────┘')
print()
bal = pm.get_payment_instrument_balance(
    payment_connector_id='<YOUR_CONNECTOR_ID>',
    payment_instrument_id=os.environ['PAYMENT_INSTRUMENT_ID'],
    chain='BASE_SEPOLIA', token='USDC', user_id='researcher001')
print(json.dumps(bal, indent=2, default=str))

print()
print('┌─────────────────────────────────────────────────────────────────┐')
print('│ 3. Payment Session (Budget Enforcement)                         │')
print('└─────────────────────────────────────────────────────────────────┘')
print()
try:
    sess = pm.get_payment_session(
        payment_session_id=os.environ['PAYMENT_SESSION_ID'],
        user_id='researcher001')
    print(json.dumps(sess, indent=2, default=str))
except Exception as e:
    print(f'  ❌ Session error: {e}')
    print('  Run: demo/0-new-session.sh')

print()
print('┌─────────────────────────────────────────────────────────────────┐')
print('│ 4. Resource Hierarchy                                           │')
print('└─────────────────────────────────────────────────────────────────┘')
print()
print(f'  PaymentManager:    {os.environ[\"PAYMENT_MANAGER_ARN\"].split(\"/\")[-1]}')
print(f'  └─ Connector:      <YOUR_CONNECTOR_ID> (Coinbase CDP)')
print(f'     └─ Instrument:  {os.environ[\"PAYMENT_INSTRUMENT_ID\"]}')
wallet = inst.get('paymentInstrumentDetails', {}).get('embeddedCryptoWallet', {}).get('walletAddress', '?')
print(f'        Wallet:      {wallet}')
print(f'        Network:     Base Sepolia (testnet)')
print(f'        Balance:     {bal[\"tokenBalance\"][\"amount\"]} USDC')
print(f'  └─ Session:        {os.environ[\"PAYMENT_SESSION_ID\"]}')
avail = sess.get('availableLimits', {}).get('availableSpendAmount', {}).get('value', '?') if 'sess' in dir() else '?'
max_s = sess.get('limits', {}).get('maxSpendAmount', {}).get('value', '?') if 'sess' in dir() else '?'
print(f'     Budget:         \${avail} available of \${max_s}')
"

echo
echo "═══════════════════════════════════════════════════════════════════"
echo "  On-chain explorer:"
echo "  https://sepolia.basescan.org/address/<YOUR_WALLET_ADDRESS>"
echo "═══════════════════════════════════════════════════════════════════"
