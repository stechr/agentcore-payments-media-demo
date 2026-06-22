#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { MerchantStack } from "../lib/merchant-stack";
import { WafMerchantStack } from "../lib/waf-merchant-stack";

const app = new cdk.App();

// Existing publisher — DIY Lambda@Edge x402 paywall (structural-only check).
// Unchanged: deploys + works exactly as before, standalone.
new MerchantStack(app, "AgentCorePaymentsMediaMerchant", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: "us-east-1" },
  crossRegionReferences: true,
});

// New publisher — managed AWS WAF "AI traffic monetization" (verifies + settles
// on-chain at the edge). Independently deployable; does not touch MerchantStack.
new WafMerchantStack(app, "AgentCorePaymentsWafMerchant", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: "us-east-1" },
  crossRegionReferences: true,
});
