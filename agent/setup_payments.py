"""
Setup helper — creates AgentCore Payments resources (PaymentManager, Connector, Instrument, Session).
Run after deploying the merchant stack and configuring Coinbase CDP credentials.
"""

import boto3
import json
import os

REGION = os.environ.get("AWS_REGION", "us-east-1")


def setup_payments():
    """Interactive setup for AgentCore Payments resources."""

    print("=" * 60)
    print("AgentCore Payments Setup — Media Content PoC")
    print("=" * 60)
    print()

    # Step 1: Check prerequisites
    print("Prerequisites:")
    print("  1. Coinbase CDP API key (from https://portal.cdp.coinbase.com/)")
    print("  2. Merchant stack deployed (CDK)")
    print("  3. AWS credentials configured for us-east-1")
    print()

    coinbase_api_key = input("Coinbase CDP API Key ID: ").strip()
    coinbase_api_secret = input("Coinbase CDP API Secret (paste, then Enter): ").strip()

    if not coinbase_api_key or not coinbase_api_secret:
        print("ERROR: Both Coinbase CDP API Key and Secret are required.")
        return

    client = boto3.client("bedrock-agentcore-control", region_name=REGION)
    runtime = boto3.client("bedrock-agentcore", region_name=REGION)

    # Step 2: Create Payment Credential Provider (via AgentCore Identity)
    print("\n[1/5] Creating Payment Credential Provider...")
    # Note: In practice, use the AgentCore Identity API to store credentials
    # This is simplified for the PoC
    print("  → Store Coinbase credentials in AgentCore Identity")
    print("  → (See docs: payments-prerequisites.md)")

    # Step 3: Create Payment Manager
    print("\n[2/5] Creating Payment Manager...")
    pm_response = client.create_payment_manager(
        name="media-content-poc",
        authorizerType="AWS_IAM",
    )
    pm_arn = pm_response["paymentManagerArn"]
    pm_id = pm_response["paymentManagerId"]
    print(f"  → Payment Manager: {pm_id}")
    print(f"  → ARN: {pm_arn}")

    # Step 4: Create Payment Connector (Coinbase CDP)
    print("\n[3/5] Creating Payment Connector (Coinbase CDP)...")
    connector_response = client.create_payment_connector(
        paymentManagerId=pm_id,
        name="coinbase-cdp",
        connectorType="CoinbaseCDP",
    )
    connector_id = connector_response["paymentConnectorId"]
    print(f"  → Connector: {connector_id}")

    # Step 5: Create Payment Instrument (wallet)
    print("\n[4/5] Creating Payment Instrument (wallet on Base Sepolia testnet)...")
    instrument_response = runtime.create_payment_instrument(
        paymentManagerId=pm_id,
        paymentConnectorId=connector_id,
        userId="researcher-001",
        network="base-sepolia",  # Testnet — free USDC from faucet.circle.com
    )
    instrument_id = instrument_response["paymentInstrumentId"]
    redirect_url = instrument_response.get("paymentInstrumentDetails", {}).get("redirectUrl", "")
    print(f"  → Instrument: {instrument_id}")
    if redirect_url:
        print(f"  → Fund wallet at: {redirect_url}")
        print("  → Open this URL to add USDC and grant agent permissions")

    # Step 6: Create Payment Session
    print("\n[5/5] Creating Payment Session (budget: $1.00 USDC)...")
    session_response = runtime.create_payment_session(
        paymentManagerId=pm_id,
        paymentInstrumentId=instrument_id,
        userId="researcher-001",
        maxSpendAmount="1000000",  # 1 USDC in micro-units (6 decimals)
        currency="USDC",
        expirySeconds=3600,  # 1 hour
    )
    session_id = session_response["paymentSessionId"]
    print(f"  → Session: {session_id}")
    print(f"  → Budget: $1.00 USDC, expires in 1 hour")

    # Output environment variables
    print("\n" + "=" * 60)
    print("Setup Complete! Export these environment variables:")
    print("=" * 60)

    env_vars = {
        "PAYMENT_MANAGER_ARN": pm_arn,
        "PAYMENT_INSTRUMENT_ID": instrument_id,
        "PAYMENT_SESSION_ID": session_id,
        "AWS_REGION": REGION,
    }

    env_file = ""
    for key, value in env_vars.items():
        line = f"export {key}={value}"
        print(f"  {line}")
        env_file += line + "\n"

    # Save to .env file
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    with open(env_path, "w") as f:
        f.write(env_file)
    print(f"\n  → Saved to {env_path}")
    print("  → Run: source agent/.env")


if __name__ == "__main__":
    setup_payments()
