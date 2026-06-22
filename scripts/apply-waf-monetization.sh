#!/usr/bin/env bash
#
# apply-waf-monetization.sh — FALLBACK ONLY.
#
# The AWS WAF "AI traffic monetization" feature (Monetize rule action +
# MonetizationConfig on AWS::WAFv2::WebACL) was announced 2026-06-15. The CDK
# stack (lib/waf-merchant-stack.ts) injects both via L1 escape-hatch, so
# `cdk synth` succeeds. IF a live `cdk deploy` rejects the unknown
# `MonetizationConfig` property because CloudFormation does not yet cover it,
# deploy the stack WITHOUT MonetizationConfig (comment the escape-hatch) and run
# this script to set it directly on the deployed web ACL via the wafv2 API.
#
# NOTE: this CLI path is ALSO unverified for a 2-day-old feature — the installed
# botocore/aws-cli may not yet expose `--monetization-config` on update-web-acl.
# If so, you need a newer CLI, or set it in the WAF console. This is the #1 thing
# the FOREGROUND deploy must validate. See docs/waf-monetization.md.
#
# Usage:
#   WEB_ACL_NAME=WafMonetizeAcl WEB_ACL_ID=<id> WEB_ACL_LOCK_TOKEN=<token> \
#   PAY_TO_WALLET=0x... PRICE_USDC=0.018 \
#   ./scripts/apply-waf-monetization.sh
#
set -euo pipefail

: "${WEB_ACL_NAME:?set WEB_ACL_NAME (from cdk output / list-web-acls)}"
: "${WEB_ACL_ID:?set WEB_ACL_ID (from list-web-acls)}"
: "${PAY_TO_WALLET:?set PAY_TO_WALLET (USDC wallet address, testnet)}"
PRICE_USDC="${PRICE_USDC:-0.002}"   # BASE price; per-rule PriceMultipliers (the
# content-tier x agent-class matrix) live in the Rules array set by the CDK stack,
# NOT here — this fallback only (re)sets the MonetizationConfig base price.
REGION="${AWS_REGION:-us-east-1}"   # CLOUDFRONT scope is managed in us-east-1

# Fetch current lock token if not supplied.
if [[ -z "${WEB_ACL_LOCK_TOKEN:-}" ]]; then
  WEB_ACL_LOCK_TOKEN=$(aws wafv2 get-web-acl \
    --name "$WEB_ACL_NAME" --scope CLOUDFRONT --id "$WEB_ACL_ID" \
    --region "$REGION" --query 'LockToken' --output text 2>/dev/null || echo "")
fi
: "${WEB_ACL_LOCK_TOKEN:?could not resolve lock token — pass WEB_ACL_LOCK_TOKEN}"

cat > /tmp/waf-monetization-config.json <<JSON
{
  "CurrencyMode": "TEST",
  "CryptoConfig": {
    "PaymentNetworks": [
      {
        "Chain": "BASE_SEPOLIA",
        "WalletAddress": "${PAY_TO_WALLET}",
        "Prices": [{ "Amount": "${PRICE_USDC}", "Currency": "USDC" }]
      }
    ]
  }
}
JSON

echo "Applying MonetizationConfig to web ACL ${WEB_ACL_NAME} (${WEB_ACL_ID}) ..."
echo "If this errors with an unknown '--monetization-config' option, the installed"
echo "AWS CLI predates the feature — upgrade the CLI or set it in the WAF console."

# Best-effort: the option name below is per the announced API and may differ.
aws wafv2 update-web-acl \
  --name "$WEB_ACL_NAME" --scope CLOUDFRONT --id "$WEB_ACL_ID" \
  --lock-token "$WEB_ACL_LOCK_TOKEN" --region "$REGION" \
  --default-action Allow={} \
  --visibility-config CloudWatchMetricsEnabled=true,MetricName=agentcore-waf-monetize,SampledRequestsEnabled=true \
  --monetization-config "file:///tmp/waf-monetization-config.json" \
  || {
    echo "update-web-acl rejected the MonetizationConfig — see note above."
    exit 1
  }

echo "Done. Verify in the WAF console that MonetizationConfig is set."
