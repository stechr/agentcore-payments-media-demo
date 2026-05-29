#!/usr/bin/env bash
# 0-new-session.sh — Create a fresh payment session and update .env
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$SCRIPT_DIR/../agent"
PYTHON="$AGENT_DIR/.venv/bin/python"
ENV_FILE="$AGENT_DIR/.env"

source "$ENV_FILE"

BUDGET="${1:-1.00}"
EXPIRY="${2:-480}"

echo "Creating fresh payment session (budget: \$$BUDGET, expiry: ${EXPIRY}min)..."

NEW_SESSION=$($PYTHON -c "
from bedrock_agentcore.payments.manager import PaymentManager
import os

pm = PaymentManager(payment_manager_arn=os.environ['PAYMENT_MANAGER_ARN'], region_name='us-east-1')
s = pm.create_payment_session(
    user_id='researcher001',
    expiry_time_in_minutes=$EXPIRY,
    limits={'maxSpendAmount': {'value': '$BUDGET', 'currency': 'USD'}},
)
print(s['paymentSessionId'])
")

echo "✅ New session: $NEW_SESSION"

# Update .env
sed -i '' "s|^export PAYMENT_SESSION_ID=.*|export PAYMENT_SESSION_ID=$NEW_SESSION|" "$ENV_FILE"
echo "✅ Updated $ENV_FILE"
echo
echo "Budget: \$$BUDGET USDC | Expiry: ${EXPIRY} minutes"
