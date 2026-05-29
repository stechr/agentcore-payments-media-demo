import * as cdk from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Construct } from "constructs";
import * as path from "path";

export class MerchantStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // === WAF IP Allowlist ===
    const allowedIps = new cdk.CfnParameter(this, "AllowedIps", {
      type: "CommaDelimitedList",
      default: "92.208.185.77/32",
      description: "CIDR blocks allowed to access the merchant",
    });

    const ipSet = new wafv2.CfnIPSet(this, "AllowedIpSet", {
      scope: "CLOUDFRONT",
      ipAddressVersion: "IPV4",
      addresses: allowedIps.valueAsList,
      name: "agentcore-payments-demo-allowed-ips",
    });

    const webAcl = new wafv2.CfnWebACL(this, "WebAcl", {
      scope: "CLOUDFRONT",
      defaultAction: { block: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: "agentcore-payments-demo",
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: "AllowDemoIps",
          priority: 0,
          action: { allow: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "allow-demo-ips",
            sampledRequestsEnabled: true,
          },
          statement: { ipSetReferenceStatement: { arn: ipSet.attrArn } },
        },
      ],
    });

    // === Merchant Content (CloudFront + Lambda@Edge) ===
    const contentBucket = new s3.Bucket(this, "ContentBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const paywallFn = new cloudfront.experimental.EdgeFunction(
      this, "X402PaywallFn", {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "index.handler",
        code: lambda.Code.fromAsset(path.join(__dirname, "../lambda/x402-paywall")),
        description: "x402 paywall — multi-merchant with enhanced 402 responses",
      }
    );

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      webAclId: webAcl.attrArn,
      enableIpv6: false,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(contentBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        edgeLambdas: [{
          functionVersion: paywallFn.currentVersion,
          eventType: cloudfront.LambdaEdgeEventType.VIEWER_REQUEST,
        }],
      },
      defaultRootObject: "index.json",
    });

    new s3deploy.BucketDeployment(this, "DeployContent", {
      sources: [s3deploy.Source.asset(path.join(__dirname, "../sample-content"))],
      destinationBucket: contentBucket,
      distribution,
    });

    // === Trust Registry API ===
    const trustRegistryFn = new lambda.Function(this, "TrustRegistryFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../lambda/trust-registry")),
      description: "Trust Registry — merchant reputation scores",
    });

    const trustApi = new apigw.HttpApi(this, "TrustRegistryApi", {
      apiName: "agentcore-payments-trust-registry",
      corsPreflight: { allowOrigins: ["*"], allowMethods: [apigw.CorsHttpMethod.GET] },
    });

    trustApi.addRoutes({
      path: "/{proxy+}",
      methods: [apigw.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration("TrustRegistryIntegration", trustRegistryFn),
    });

    // === Feedback Service API ===
    const feedbackFn = new lambda.Function(this, "FeedbackFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../lambda/feedback-service")),
      description: "Feedback Service — agent quality ratings",
    });

    const feedbackApi = new apigw.HttpApi(this, "FeedbackApi", {
      apiName: "agentcore-payments-feedback",
      corsPreflight: { allowOrigins: ["*"], allowMethods: [apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.POST] },
    });

    feedbackApi.addRoutes({
      path: "/{proxy+}",
      methods: [apigw.HttpMethod.GET, apigw.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration("FeedbackIntegration", feedbackFn),
    });

    // === Outputs ===
    new cdk.CfnOutput(this, "DistributionUrl", {
      value: `https://${distribution.distributionDomainName}`,
      description: "Merchant content URL (x402-protected, IP-restricted)",
    });

    new cdk.CfnOutput(this, "TrustRegistryUrl", {
      value: trustApi.apiEndpoint,
      description: "Trust Registry API — merchant reputation data",
    });

    new cdk.CfnOutput(this, "FeedbackServiceUrl", {
      value: feedbackApi.apiEndpoint,
      description: "Feedback Service API — agent quality ratings",
    });

    new cdk.CfnOutput(this, "ContentBucketName", {
      value: contentBucket.bucketName,
    });
  }
}
