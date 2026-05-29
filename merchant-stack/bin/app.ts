#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { MerchantStack } from "../lib/merchant-stack";

const app = new cdk.App();
new MerchantStack(app, "AgentCorePaymentsMediaMerchant", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: "us-east-1" },
  crossRegionReferences: true,
});
