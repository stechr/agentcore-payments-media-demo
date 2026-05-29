#!/bin/bash
# Creates the IAM service role required by AgentCore Payments.
# This role is assumed by bedrock-agentcore.amazonaws.com at runtime.
set -euo pipefail

ACCOUNT_ID="<YOUR_ACCOUNT_ID>"
REGION="us-east-1"
ROLE_NAME="AgentCorePaymentsResourceRetrievalRole"
PM_NAME="media-content-poc"

echo "Creating IAM service role: $ROLE_NAME"

# Trust policy — allows AgentCore Payments service to assume this role
TRUST_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "bedrock-agentcore.amazonaws.com" },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": { "aws:SourceAccount": "${ACCOUNT_ID}" },
        "ArnLike": { "aws:SourceArn": "arn:aws:bedrock-agentcore:${REGION}:${ACCOUNT_ID}:payment-manager/${PM_NAME}-*" }
      }
    }
  ]
}
EOF
)

# Create the role (ignore if exists)
aws iam create-role \
  --role-name "$ROLE_NAME" \
  --assume-role-policy-document "$TRUST_POLICY" \
  --description "Service role for AgentCore Payments - assumed at runtime for credential retrieval" \
  2>/dev/null || echo "  → Role already exists, updating trust policy..."

aws iam update-assume-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-document "$TRUST_POLICY" 2>/dev/null || true

# Base permissions policy
PERMISSIONS_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "WorkloadIdentityCreation",
      "Effect": "Allow",
      "Action": ["bedrock-agentcore:CreateWorkloadIdentity"],
      "Resource": [
        "arn:aws:bedrock-agentcore:${REGION}:${ACCOUNT_ID}:workload-identity-directory/default",
        "arn:aws:bedrock-agentcore:${REGION}:${ACCOUNT_ID}:workload-identity-directory/default/workload-identity/*"
      ]
    },
    {
      "Sid": "WorkloadIdentityAccess",
      "Effect": "Allow",
      "Action": ["bedrock-agentcore:GetWorkloadAccessToken"],
      "Resource": [
        "arn:aws:bedrock-agentcore:${REGION}:${ACCOUNT_ID}:workload-identity-directory/default",
        "arn:aws:bedrock-agentcore:${REGION}:${ACCOUNT_ID}:workload-identity-directory/default/workload-identity/${PM_NAME}-*"
      ]
    },
    {
      "Sid": "PaymentTokenBaseAccess",
      "Effect": "Allow",
      "Action": ["bedrock-agentcore:GetResourcePaymentToken"],
      "Resource": [
        "arn:aws:bedrock-agentcore:${REGION}:${ACCOUNT_ID}:token-vault/default",
        "arn:aws:bedrock-agentcore:${REGION}:${ACCOUNT_ID}:token-vault/default/paymentcredentialprovider/*",
        "arn:aws:bedrock-agentcore:${REGION}:${ACCOUNT_ID}:workload-identity-directory/default",
        "arn:aws:bedrock-agentcore:${REGION}:${ACCOUNT_ID}:workload-identity-directory/default/workload-identity/${PM_NAME}-*"
      ]
    }
  ]
}
EOF
)

POLICY_NAME="AgentCorePaymentsBasePermissions"
aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "$POLICY_NAME" \
  --policy-document "$PERMISSIONS_POLICY"

echo "  ✅ Role created: arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"
echo "  ✅ Base permissions attached"
echo ""
echo "Next: Run setup_payments.py with your Coinbase CDP credentials"
