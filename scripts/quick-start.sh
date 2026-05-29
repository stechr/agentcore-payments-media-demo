#!/bin/bash
# Quick-start: takes Coinbase CDP credentials and runs the full AgentCore Payments setup.
# Prerequisites: Coinbase CDP account created at portal.cdp.coinbase.com
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
REGION="us-east-1"
MERCHANT_URL="https://d1zywac14ibm8x.cloudfront.net"

echo "═══════════════════════════════════════════════════════════"
echo " AgentCore Payments — Quick Start"
echo " Merchant: $MERCHANT_URL"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check for CDP credentials
if [[ -z "${CDP_API_KEY_ID:-}" ]] || [[ -z "${CDP_API_KEY_SECRET:-}" ]]; then
  echo "Coinbase CDP credentials required."
  echo ""
  echo "  1. Go to https://portal.cdp.coinbase.com"
  echo "  2. Create a project → Generate Ed25519 API key"
  echo "  3. Export credentials:"
  echo ""
  echo "     export CDP_API_KEY_ID='your-key-id'"
  echo "     export CDP_API_KEY_SECRET='your-secret'"
  echo "     $0"
  echo ""
  exit 1
fi

echo "[1/4] Activating Python environment..."
cd "$PROJECT_DIR/agent"
if [[ ! -d .venv ]]; then
  uv venv .venv
  uv pip install -r requirements.txt -p .venv/bin/python
fi
source .venv/bin/activate

echo "[2/4] Creating PaymentManager + Connector + Instrument..."
python - <<'PYTHON'
import boto3
import os
import json

REGION = "us-east-1"
cdp_key_id = os.environ["CDP_API_KEY_ID"]
cdp_key_secret = os.environ["CDP_API_KEY_SECRET"]

control = boto3.client("bedrock-agentcore-control", region_name=REGION)
runtime = boto3.client("bedrock-agentcore", region_name=REGION)

# Create Payment Credential Provider
print("  → Creating Payment Credential Provider...")
cred_response = control.create_payment_credential_provider(
    name="coinbase-cdp-media-poc",
    paymentProviderConfigurations={
        "coinbaseCdp": {
            "apiKeyId": cdp_key_id,
            "apiKeySecret": cdp_key_secret,
        }
    },
)
cred_provider_arn = cred_response["paymentCredentialProviderArn"]
print(f"    Credential Provider: {cred_provider_arn}")

# Create Payment Manager
print("  → Creating Payment Manager...")
pm_response = control.create_payment_manager(
    name="media-content-poc",
    authorizerType="AWS_IAM",
    roleArn=f"arn:aws:iam::<YOUR_ACCOUNT_ID>:role/AgentCorePaymentsResourceRetrievalRole",
)
pm_id = pm_response["paymentManagerId"]
pm_arn = pm_response["paymentManagerArn"]
print(f"    Payment Manager: {pm_id}")

# Wait for READY state
import time
for _ in range(30):
    status = control.get_payment_manager(paymentManagerId=pm_id)["status"]
    if status == "READY":
        break
    time.sleep(2)
print(f"    Status: {status}")

# Create Payment Connector
print("  → Creating Payment Connector (Coinbase CDP)...")
connector_response = control.create_payment_connector(
    paymentManagerId=pm_id,
    name="coinbase-cdp",
    connectorType="COINBASE_CDP",
    paymentCredentialProviderArn=cred_provider_arn,
)
connector_id = connector_response["paymentConnectorId"]
print(f"    Connector: {connector_id}")

# Wait for connector READY
for _ in range(30):
    status = control.get_payment_connector(
        paymentManagerId=pm_id, paymentConnectorId=connector_id
    )["status"]
    if status == "READY":
        break
    time.sleep(2)

# Create Payment Instrument (wallet)
print("  → Creating Payment Instrument (Base Sepolia wallet)...")
instrument_response = runtime.create_payment_instrument(
    paymentManagerId=pm_id,
    paymentConnectorId=connector_id,
    userId="researcher-001",
    network="base-sepolia",
)
instrument_id = instrument_response["paymentInstrumentId"]
redirect_url = instrument_response.get("paymentInstrumentDetails", {}).get("redirectUrl", "")
wallet_address = instrument_response.get("paymentInstrumentDetails", {}).get("walletAddress", "")
print(f"    Instrument: {instrument_id}")
if wallet_address:
    print(f"    Wallet: {wallet_address}")

# Create Payment Session
print("  → Creating Payment Session (budget: $1.00 USDC, 1 hour)...")
session_response = runtime.create_payment_session(
    paymentManagerId=pm_id,
    paymentInstrumentId=instrument_id,
    userId="researcher-001",
    maxSpendAmount="1000000",
    currency="USDC",
    expirySeconds=3600,
)
session_id = session_response["paymentSessionId"]
print(f"    Session: {session_id}")

# Write .env file
env_content = f"""export PAYMENT_MANAGER_ARN={pm_arn}
export PAYMENT_INSTRUMENT_ID={instrument_id}
export PAYMENT_SESSION_ID={session_id}
export MERCHANT_URL=https://d1zywac14ibm8x.cloudfront.net
export AWS_REGION=us-east-1
"""
env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "agent", ".env")
# Write relative to project
import pathlib
env_file = pathlib.Path(__file__).parent.parent / "agent" / ".env" if "__file__" in dir() else pathlib.Path("agent/.env")
with open(".env", "w") as f:
    f.write(env_content)

print(f"\n    .env written to agent/.env")
if redirect_url:
    print(f"\n  ⚠️  Fund your wallet:")
    print(f"    {redirect_url}")
    print(f"    OR: https://faucet.circle.com → Base Sepolia → paste wallet address")
elif wallet_address:
    print(f"\n  ⚠️  Fund your wallet at https://faucet.circle.com")
    print(f"    Network: Base Sepolia")
    print(f"    Address: {wallet_address}")
PYTHON

echo ""
echo "[3/4] Environment ready!"
echo ""
echo "  source agent/.env"
echo ""
echo "[4/4] Run the research agent:"
echo ""
echo "  cd $PROJECT_DIR/agent"
echo "  source .venv/bin/activate"
echo "  source .env"
echo "  python research_agent.py"
echo ""
echo "═══════════════════════════════════════════════════════════"
echo " Done! Fund your wallet, then run the agent."
echo "═══════════════════════════════════════════════════════════"
